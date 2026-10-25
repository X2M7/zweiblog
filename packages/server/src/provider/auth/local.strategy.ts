import { PassportStrategy } from '@nestjs/passport';
import { Strategy, IStrategyOptionsWithRequest, VerifyFunctionWithRequest } from 'passport-local';
import { Injectable } from '@nestjs/common';
import { AuthProvider } from './auth.provider';
import { Request } from 'express';
import { loginCredentials } from './login.credentials';

// Select the request-aware overload for Nest's constructor type inference.
const RequestLocalStrategy: new (
  options: IStrategyOptionsWithRequest,
  verify: VerifyFunctionWithRequest,
) => Strategy = Strategy;

@Injectable()
export class LocalStrategy extends PassportStrategy(RequestLocalStrategy) {
  constructor(private readonly authProvider: AuthProvider) {
    super({ passReqToCallback: true });
    this.authProvider = authProvider;
  }

  async validate(request: Request, _username: string, _password: string): Promise<any> {
    const { username, password } = loginCredentials(request);
    const user = await this.authProvider.validateUser(username, password);
    if (user) return user;
    else {
      return { fail: true };
    }
  }
}
