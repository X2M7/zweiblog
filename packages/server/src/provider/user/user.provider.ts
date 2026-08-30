import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UpdateUserDto } from 'src/types/user.dto';
import { User, UserDocument } from 'src/scheme/user.schema';
import { Collaborator } from 'src/types/collaborator';
import { encryptPassword, makeSalt, verifyPassword, washPassword } from 'src/utils/crypto';

const BACKUP_CREDENTIAL_VERSION = 1;
const LEGACY_PASSWORD_PATTERN = /^[a-f0-9]{64}$/;
const MAX_USERNAME_LENGTH = 128;
const MAX_NICKNAME_LENGTH = 256;
const BACKUP_INPUT_KEYS = new Set([
  'version',
  'id',
  'type',
  'name',
  'nickname',
  'password',
  'salt',
  // Compatibility with backups produced before the credential envelope.
  '_id',
  '__v',
  'createdAt',
  'permissions',
]);

export interface UserBackupRecord {
  version: typeof BACKUP_CREDENTIAL_VERSION;
  id: 0;
  type: 'admin';
  name: string;
  nickname?: string;
  password: string;
  salt: string;
}

function isCanonicalBase64(value: string, expectedBytes: number): boolean {
  try {
    const decoded = Buffer.from(value, 'base64');
    return decoded.length === expectedBytes && decoded.toString('base64') === value;
  } catch {
    return false;
  }
}

function isValidScryptHash(value: string): boolean {
  const parts = value.split('$');
  if (
    parts.length !== 7 ||
    parts[0] !== 'scrypt' ||
    parts[1] !== 'v1' ||
    parts[2] !== '32768' ||
    parts[3] !== '8' ||
    parts[4] !== '1'
  ) {
    return false;
  }
  return isCanonicalBase64(parts[5], 16) && isCanonicalBase64(parts[6], 32);
}

function isSafeText(value: unknown, maxLength: number): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= maxLength &&
    value.trim() === value &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function parseUserBackupRecord(input: unknown): UserBackupRecord | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return null;
  }

  const record = input as Record<string, unknown>;
  if (Object.keys(record).some((key) => !BACKUP_INPUT_KEYS.has(key))) {
    return null;
  }
  if (
    !isSafeText(record.name, MAX_USERNAME_LENGTH) ||
    typeof record.password !== 'string' ||
    typeof record.salt !== 'string' ||
    !isCanonicalBase64(record.salt, 32)
  ) {
    return null;
  }

  const validScrypt = isValidScryptHash(record.password);
  const validLegacy = LEGACY_PASSWORD_PATTERN.test(record.password);
  if (!validScrypt && !validLegacy) {
    return null;
  }
  if (record.id !== undefined && record.id !== 0) {
    return null;
  }
  if (record.type !== undefined && record.type !== 'admin') {
    return null;
  }
  if (record.version !== undefined && record.version !== BACKUP_CREDENTIAL_VERSION) {
    return null;
  }
  if (
    record.nickname !== undefined &&
    (typeof record.nickname !== 'string' ||
      record.nickname.length > MAX_NICKNAME_LENGTH ||
      /[\u0000-\u001f\u007f]/.test(record.nickname))
  ) {
    return null;
  }

  return {
    version: BACKUP_CREDENTIAL_VERSION,
    id: 0,
    type: 'admin',
    name: record.name,
    ...(typeof record.nickname === 'string' ? { nickname: record.nickname } : {}),
    password: record.password,
    salt: record.salt,
  };
}

@Injectable()
export class UserProvider {
  logger = new Logger(UserProvider.name);
  constructor(@InjectModel('User') private userModel: Model<UserDocument>) {}
  async getUser(isList?: boolean) {
    if (isList) {
      return await this.userModel.findOne({ id: 0 }, { id: 1, name: 1, nickname: 1 });
    }
    return await this.userModel.findOne({ id: 0 }).exec();
  }

  /**
   * Export the administrator credential for an authenticated backup request.
   * This is deliberately separate from normal user DTOs so secrets cannot be
   * accidentally re-hashed or mass-assigned during restore.
   */
  async exportForBackup(): Promise<UserBackupRecord> {
    const user = await this.userModel
      .findOne({ id: 0 }, { _id: 0, id: 1, type: 1, name: 1, nickname: 1, password: 1, salt: 1 })
      .lean()
      .exec();
    const backup = parseUserBackupRecord(user);
    if (!backup) {
      throw new InternalServerErrorException('Stored administrator credential is invalid');
    }
    return backup;
  }

  /** Restore only a validated password digest; never pass backup data to updateUser. */
  async importFromBackup(input: unknown): Promise<void> {
    const backup = parseUserBackupRecord(input);
    if (!backup) {
      throw new BadRequestException('Invalid administrator credential in backup');
    }

    const currentUser = await this.userModel.findOne({ id: 0 }, { _id: 1 }).lean().exec();
    if (!currentUser) {
      throw new NotFoundException('Administrator account not found');
    }

    const set: Record<string, unknown> = {
      name: backup.name,
      password: backup.password,
      salt: backup.salt,
      type: 'admin',
    };
    if (backup.nickname !== undefined) {
      set.nickname = backup.nickname;
    }

    await this.userModel
      .updateOne(
        { id: 0 },
        backup.nickname === undefined ? { $set: set, $unset: { nickname: 1 } } : { $set: set },
      )
      .exec();
  }
  async washUserWithSalt() {
    // 如果没加盐的老版本，给改成带加盐的。
    const users = await this.userModel.find({
      $or: [
        {
          salt: '',
        },
        {
          salt: { $exists: false },
        },
      ],
    });
    if (users && users.length > 0) {
      this.logger.log(`老版本清洗密码未加盐用户 ${users.length} 人`);
      for (const user of users) {
        const salt = makeSalt();
        const newPassword = await washPassword(user.name, user.password, salt);
        await this.userModel.updateOne({ id: user.id }, { password: newPassword, salt });
      }
    }
  }

  async validateUser(name: string, password: string) {
    const user = await this.userModel.findOne({ name });
    if (!user) {
      return null;
    }

    const verification = await verifyPassword(name, password, user.salt || '', user.password);
    if (!verification.valid) {
      return null;
    }
    if (verification.needsRehash) {
      await this.updateSalt(user, password);
    }
    return user;
  }

  async updateSalt(user: User, passwordInput: string) {
    const newSalt = makeSalt();
    const password = await encryptPassword(user.name, passwordInput, newSalt);
    await this.userModel.updateOne(
      { id: user.id },
      {
        salt: newSalt,
        password,
      },
    );
  }

  async updateUser(updateUserDto: UpdateUserDto) {
    const currUser = await this.getUser();

    if (!currUser) {
      throw new NotFoundException();
    } else {
      const salt = makeSalt();
      const password = await encryptPassword(updateUserDto.name, updateUserDto.password, salt);
      return await this.userModel
        .updateOne(
          { id: currUser.id },
          {
            ...updateUserDto,
            password,
            salt,
          },
        )
        .exec();
    }
  }
  async getNewId() {
    const [lastUser] = await this.userModel.find({}).sort({ id: -1 }).limit(1);
    if (!lastUser) {
      return 1;
    } else {
      return lastUser.id + 1;
    }
  }
  async getCollaboratorByName(name: string) {
    return await this.userModel.findOne({ name: name, type: 'collaborator' });
  }
  async getCollaboratorById(id: number) {
    return await this.userModel.findOne({ id, type: 'collaborator' });
  }
  async getAllCollaborators(isList?: boolean) {
    if (isList) {
      return await this.userModel.find(
        { type: 'collaborator' },
        { id: 1, name: 1, nickname: 1, _id: 0 },
      );
    }
    return await this.userModel.find({ type: 'collaborator' }, { salt: 0, password: 0, _id: 0 });
  }

  async createCollaborator(collaboratorDto: Collaborator) {
    const { name } = collaboratorDto;
    const oldData = await this.getCollaboratorByName(name);
    if (oldData) {
      throw new ForbiddenException('已有为该用户名的协作者，不可重复创建！');
    }
    const salt = makeSalt();
    const password = await encryptPassword(collaboratorDto.name, collaboratorDto.password, salt);
    return await this.userModel.create({
      id: await this.getNewId(),
      type: 'collaborator',
      ...collaboratorDto,
      password,
      salt,
    });
  }
  async updateCollaborator(collaboratorDto: Collaborator) {
    const { name } = collaboratorDto;
    const oldData = await this.getCollaboratorByName(name);
    if (!oldData) {
      throw new ForbiddenException('没有此协作者！无法更新！');
    }
    const salt = makeSalt();
    const password = await encryptPassword(collaboratorDto.name, collaboratorDto.password, salt);
    return await this.userModel.updateOne(
      {
        id: oldData.id,
        type: 'collaborator',
      },
      {
        ...collaboratorDto,
        password,
        salt,
      },
    );
  }
  async deleteCollaborator(id: number) {
    await this.userModel.deleteOne({ id: id, type: 'collaborator' });
  }
}
