import {
  Controller,
  UseGuards,
  Logger,
  Get,
  Post,
  Body,
  BadRequestException,
  NotFoundException,
  Patch,
  Put,
  Delete,
  Query,
  Res,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import { Response } from 'express';
import { removeCustomPageTemporaryUpload } from 'src/utils/customPageUpload';
import { config } from 'src/config';
import { AdminGuard } from 'src/provider/auth/auth.guard';
import { CustomPageProvider } from 'src/provider/customPage/customPage.provider';
import { StaticProvider } from 'src/provider/static/static.provider';
import { ApiToken } from 'src/provider/swagger/token';
import { CustomPage } from 'src/scheme/customPage.schema';
import { customPageUploadOptions } from 'src/utils/uploadLimits';

const WINDOWS_RESERVED_ARCHIVE_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export function getCustomPageArchiveName(name: unknown, pathname: unknown) {
  const pathFallback =
    typeof pathname === 'string'
      ? pathname.replace(/\\/g, '/').split('/').filter(Boolean).pop()
      : undefined;
  const candidate = typeof name === 'string' && name.trim() ? name : pathFallback || 'custom-page';
  let safeBaseName = candidate
    .normalize('NFC')
    .replace(/[<>:"/\\|?*\u0000-\u001f\u007f]/g, '-')
    .trim()
    .replace(/[. ]+$/g, '');
  if (!safeBaseName || safeBaseName === '.' || safeBaseName === '..') {
    safeBaseName = 'custom-page';
  }
  if (WINDOWS_RESERVED_ARCHIVE_NAME.test(safeBaseName.split('.')[0])) {
    safeBaseName = `_${safeBaseName}`;
  }

  let boundedBaseName = '';
  for (const character of safeBaseName) {
    if (Buffer.byteLength(`${boundedBaseName}${character}.zip`, 'utf-8') > 180) break;
    boundedBaseName += character;
  }
  return `${boundedBaseName || 'custom-page'}.zip`;
}

@ApiTags('customPage')
@UseGuards(...AdminGuard)
@ApiToken
@Controller('/api/admin/customPage')
export class CustomPageController {
  private readonly logger = new Logger(CustomPageController.name);
  constructor(
    private readonly customPageProvider: CustomPageProvider,
    private readonly staticProvider: StaticProvider,
  ) {}

  private async getCustomPageOrThrow(pathname: string) {
    const customPage = await this.customPageProvider.getCustomPageByPath(pathname);
    if (!customPage) {
      throw new NotFoundException('Custom page not found');
    }
    if (customPage.type !== 'file' && customPage.type !== 'folder') {
      throw new BadRequestException('Invalid custom page type');
    }
    return customPage;
  }

  private async assertFolderCustomPage(pathname: string) {
    const customPage = await this.getCustomPageOrThrow(pathname);
    if (customPage.type !== 'folder') {
      throw new BadRequestException('Custom page must be a multi-file page');
    }
  }

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', customPageUploadOptions))
  async upload(
    @UploadedFile() file: any,
    @Query('path') path: string,
    @Query('name') name: string,
  ) {
    try {
      if (
        !file?.path ||
        typeof name !== 'string' ||
        !name ||
        name.length > 4096 ||
        /[\u0000-\u001f\u007f]/.test(name)
      ) {
        throw new BadRequestException('A valid file name is required');
      }
      await this.assertFolderCustomPage(path);
      this.logger.log(`上传自定义页面文件：${path}\t ${name}`);
      const res = await this.staticProvider.uploadCustomPageFile(file, path, name);
      return {
        statusCode: 200,
        data: res,
      };
    } finally {
      await removeCustomPageTemporaryUpload(file?.path);
    }
  }

  @Get('/all')
  async getAll() {
    return {
      statusCode: 200,
      data: await this.customPageProvider.getAll(),
    };
  }
  @Get('/folder')
  async getFolderFiles(@Query('path') path: string) {
    return {
      statusCode: 200,
      data: await this.staticProvider.getFolderFiles(path),
    };
  }
  @Get('/file')
  async getFileData(@Query('path') path: string, @Query('key') subPath: string) {
    return {
      statusCode: 200,
      data: await this.staticProvider.getFileContent(path, subPath),
    };
  }
  @Get('/export')
  async exportProject(@Query('path') pathname: string, @Res() res: Response) {
    const customPage = await this.getCustomPageOrThrow(pathname);
    const archive = await this.staticProvider.exportCustomPageProject(
      customPage.path,
      customPage.type,
      customPage.html,
    );
    const archiveName = getCustomPageArchiveName(customPage.name, customPage.path);
    const cleanupSafely = async () => {
      try {
        await archive.cleanup();
      } catch (error) {
        this.logger.error(
          `Failed to clean up custom page export: ${
            error instanceof Error ? error.message : 'unknown error'
          }`,
        );
      }
    };

    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('application/zip');
    res.once('close', () => {
      void cleanupSafely();
    });
    try {
      return res.download(archive.archivePath, archiveName, (error) => {
        void cleanupSafely();
        if (error) {
          this.logger.error(`Failed to send custom page export: ${error.message}`);
          if (!res.headersSent) {
            res.status(500).end();
          }
        }
      });
    } catch (error) {
      await cleanupSafely();
      throw error;
    }
  }
  @Get()
  async getOneByPath(@Query('path') path: string) {
    return {
      statusCode: 200,
      data: await this.customPageProvider.getCustomPageByPath(path),
    };
  }
  @Post()
  async createOne(@Body() dto: CustomPage) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    const data = await this.customPageProvider.createCustomPage(dto);
    return {
      statusCode: 200,
      data,
    };
  }
  @Post('file')
  async createFile(@Query('path') pathname: string, @Query('subPath') subPath: string) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    const data = await this.staticProvider.createFile(pathname, subPath);
    return {
      statusCode: 200,
      data,
    };
  }
  @Post('folder')
  async createFolder(@Query('path') pathname: string, @Query('subPath') subPath: string) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    const data = await this.staticProvider.createFolder(pathname, subPath);
    return {
      statusCode: 200,
      data,
    };
  }

  @Put('file')
  async updateFileInFolder(@Body() dto: { filePath: string; pathname: string; content: string }) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }

    const data = await this.staticProvider.updateCustomPageFileContent(
      dto.pathname,
      dto.filePath,
      dto.content,
    );
    return {
      statusCode: 200,
      data,
    };
  }

  @Patch('file')
  async renameFileInFolder(
    @Body() dto: { pathname: string; filePath: string; newBaseName: string },
  ) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }

    await this.assertFolderCustomPage(dto?.pathname);
    const data = await this.staticProvider.renameCustomPageFile(
      dto.pathname,
      dto.filePath,
      dto.newBaseName,
    );
    return {
      statusCode: 200,
      data,
    };
  }

  @Delete('file')
  async deleteFileInFolder(
    @Query('pathname') pathname: string,
    @Query('filePath') filePath: string,
  ) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }

    await this.assertFolderCustomPage(pathname);
    const data = await this.staticProvider.deleteCustomPageFile(pathname, filePath);
    return {
      statusCode: 200,
      data,
    };
  }

  @Delete('folder')
  async deleteFolderInFolder(
    @Query('pathname') pathname: string,
    @Query('folderPath') folderPath: string,
  ) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }

    await this.assertFolderCustomPage(pathname);
    const data = await this.staticProvider.deleteCustomPageSubfolder(pathname, folderPath);
    return {
      statusCode: 200,
      data,
    };
  }

  @Put()
  async updateOne(@Body() dto: CustomPage) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    const data = await this.customPageProvider.updateCustomPage(dto);
    return {
      statusCode: 200,
      data,
    };
  }
  @Delete()
  async deleteOne(@Query('path') path: string) {
    if (config.demo && config.demo == 'true') {
      return {
        statusCode: 401,
        message: '演示站禁止修改此项！',
      };
    }
    const toDelete = await this.customPageProvider.getCustomPageByPath(path);
    if (toDelete && toDelete.type == 'folder') {
      await this.staticProvider.deleteCustomPage(path);
    }
    const data = await this.customPageProvider.deleteByPath(path);
    return {
      statusCode: 200,
      data,
    };
  }
}
