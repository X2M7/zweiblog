import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { PassportModule } from '@nestjs/passport';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { AuthController } from './auth.controller';
import { AuthProvider } from 'src/provider/auth/auth.provider';
import { UserProvider } from 'src/provider/user/user.provider';
import { LogProvider } from 'src/provider/log/log.provider';
import { TokenProvider } from 'src/provider/token/token.provider';
import { CacheProvider } from 'src/provider/cache/cache.provider';
import { InitProvider } from 'src/provider/init/init.provider';
import { PipelineProvider } from 'src/provider/pipeline/pipeline.provider';
import { LoginGuard } from 'src/provider/auth/login.guard';
import { TokenGuard } from 'src/provider/auth/token.guard';
import { JwtStrategy } from 'src/provider/auth/jwt.strategy';
import { MetaProvider } from 'src/provider/meta/meta.provider';
import { RateLimitProvider } from 'src/provider/rateLimit/rateLimit.provider';

describe('authenticated, idempotent logout', () => {
  let app: any;
  let pipeline: any;
  let tokens: any;
  let limits: any;
  let jwt: JwtService;
  let secretBefore: any;
  beforeAll(async () => {
    secretBefore = global.jwtSecret;
    global.jwtSecret = 'logout-regression-test-secret-only';
    jwt = new JwtService({ secret: global.jwtSecret });
    pipeline = { dispatchEvent: jest.fn().mockResolvedValue(undefined) };
    tokens = { checkToken: jest.fn(), disableToken: jest.fn() };
    limits = { consume: jest.fn() };
    const module = await Test.createTestingModule({
      imports: [PassportModule],
      controllers: [AuthController],
      providers: [
        JwtStrategy,
        TokenGuard,
        { provide: AuthProvider, useValue: {} },
        { provide: UserProvider, useValue: { getUser: async () => ({ nickname: 'owner' }) } },
        { provide: MetaProvider, useValue: { getSiteInfo: async () => ({ author: 'owner' }) } },
        { provide: LogProvider, useValue: {} },
        { provide: TokenProvider, useValue: tokens },
        { provide: CacheProvider, useValue: {} },
        { provide: InitProvider, useValue: {} },
        { provide: PipelineProvider, useValue: pipeline },
        { provide: LoginGuard, useValue: {} },
        { provide: RateLimitProvider, useValue: limits },
      ],
    })
      .overrideGuard(LoginGuard)
      .useValue({ canActivate: () => true })
      .compile();
    app = module.createNestApplication();
    await app.init();
    await app.listen(0, '127.0.0.1');
  });
  beforeEach(() => {
    jest.clearAllMocks();
    tokens.checkToken.mockResolvedValue(true);
    tokens.disableToken.mockResolvedValue({ modifiedCount: 1 });
    limits.consume.mockResolvedValue({ allowed: true });
  });
  afterAll(async () => {
    await app?.close();
    global.jwtSecret = secretBefore;
  });
  it.each(['missing', 'forged', 'expired', 'disabled'])(
    'does not dispatch with a %s session',
    async (kind) => {
      let token =
        kind === 'forged'
          ? 'not-a-jwt'
          : jwt.sign({ sub: 0, username: 'owner' }, { expiresIn: kind === 'expired' ? -1 : 60 });
      if (kind === 'disabled') tokens.checkToken.mockResolvedValue(false);
      const call = request(app.getHttpServer()).post('/api/admin/auth/logout');
      if (kind !== 'missing') call.set('token', token);
      await call.expect(401);
      expect(pipeline.dispatchEvent).not.toHaveBeenCalled();
      expect(tokens.disableToken).not.toHaveBeenCalled();
    },
  );
  it('dispatches only once when concurrent valid requests revoke the same token', async () => {
    const token = jwt.sign({ sub: 0, username: 'owner' }, { expiresIn: 60 });
    tokens.disableToken
      .mockResolvedValueOnce({ modifiedCount: 1 })
      .mockResolvedValue({ modifiedCount: 0 });
    await Promise.all(
      [1, 2].map(() =>
        request(app.getHttpServer()).post('/api/admin/auth/logout').set('token', token).expect(201),
      ),
    );
    expect(pipeline.dispatchEvent).toHaveBeenCalledTimes(1);
    expect(pipeline.dispatchEvent).toHaveBeenCalledWith('logout', {});
  });
  it('limits authenticated event requests before revocation or dispatch', async () => {
    const token = jwt.sign({ sub: 0, username: 'owner' }, { expiresIn: 60 });
    limits.consume.mockResolvedValue({ allowed: false, retryAfterSeconds: 60 });
    await request(app.getHttpServer())
      .post('/api/admin/auth/logout')
      .set('token', token)
      .expect(429);
    expect(pipeline.dispatchEvent).not.toHaveBeenCalled();
    expect(tokens.disableToken).not.toHaveBeenCalled();
  });
});
