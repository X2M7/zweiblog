import { BadRequestException } from '@nestjs/common';
import { Request } from 'express';

/** Passport's default body-or-query fallback must never select a different identity. */
export function loginCredentials(request: Request) {
  const { username, password } = request.body || {};
  if (
    request.query?.username !== undefined ||
    request.query?.password !== undefined ||
    typeof username !== 'string' ||
    !username.length ||
    username.length > 128 ||
    typeof password !== 'string' ||
    !password.length ||
    password.length > 1024
  ) {
    throw new BadRequestException(
      'Login requires username and password strings in the request body',
    );
  }
  return { username, password };
}
