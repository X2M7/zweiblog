import { CanActivate, ConflictException, ExecutionContext, Injectable } from '@nestjs/common';
import { InitProvider } from '../init/init.provider';

@Injectable()
export class NotInitializedGuard implements CanActivate {
  constructor(private readonly initProvider: InitProvider) {}

  async canActivate(_context: ExecutionContext) {
    if (await this.initProvider.checkHasInited()) {
      throw new ConflictException('ZweiBlog has already been initialized');
    }
    return true;
  }
}
