import {
  CallHandler,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  INestApplication,
  UnauthorizedException,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { AllExceptionsFilter } from '../src/bootstrap/all-exceptions.filter';
import { TelemetryValidationPipe } from '../src/shared/telemetry-validation.pipe';
import { ClubCheckInController } from '../src/purely-club/check-in/club-check-in.controller';
import { ClubCheckInService } from '../src/purely-club/check-in/club-check-in.service';
import {
  buildCheckInBusinessError,
  CHECK_IN_ALREADY_DONE_CODE,
} from '../src/purely-club/check-in/club-check-in.errors';
import { ClubJwtAuthGuard } from '../src/purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../src/purely-club/stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../src/purely-club/stores/club-stores.types';

const NOW = new Date('2026-11-06T08:00:00.000Z');

const context: ClubCurrentContext = {
  user: {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '会员用户',
    createdAt: NOW,
    updatedAt: NOW,
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  },
  store: {
    id: 11,
    name: '望京旗舰店',
    address: '',
    businessMode: 'general' as const,
    memberCareEnabled: false,
    createdAt: NOW,
    updatedAt: NOW,
  },
};

const statusDto = {
  activityEnabled: true,
  activityStartAt: 1761969600000,
  activityEndAt: 1764551600000,
  todayCheckedIn: false,
  continuousDays: 2,
  pointsPerCheckIn: 3,
  pointsBalance: 128,
  checkedDates: ['2026-11-04', '2026-11-05'],
  serverTime: NOW.getTime(),
};

const resultDto = {
  checkedInAt: NOW.getTime(),
  awardedPoints: 3,
  pointsBalance: 131,
  continuousDays: 3,
  description: '每日签到 +3 积分',
};

type AuthMode = 'ok' | 'anonymous' | 'wrong-scope';
let authMode: AuthMode = 'ok';

const guardStub: CanActivate = {
  canActivate(ctx: ExecutionContext): boolean {
    if (authMode === 'anonymous') {
      throw new UnauthorizedException('未登录或登录态已失效');
    }
    if (authMode === 'wrong-scope') {
      throw new ForbiddenException('当前账号不可访问 purely-club 接口');
    }
    ctx.switchToHttp().getRequest().user = context.user;
    return true;
  },
};

const interceptorStub = {
  intercept(ctx: ExecutionContext, next: CallHandler) {
    ctx.switchToHttp().getRequest().clubCurrentContext = context;
    return next.handle();
  },
};

const clubCheckInService = {
  getStatus: jest.fn(),
  submit: jest.fn(),
};

async function buildApp(withThrottler = false): Promise<INestApplication> {
  const builder = Test.createTestingModule({
    imports: withThrottler
      ? [
          ThrottlerModule.forRoot({
            throttlers: [{ name: 'default', ttl: 60_000, limit: 100 }],
          }),
        ]
      : [],
    controllers: [ClubCheckInController],
    providers: [
      { provide: ClubCheckInService, useValue: clubCheckInService },
      ...(withThrottler
        ? [{ provide: APP_GUARD, useClass: ThrottlerGuard }]
        : []),
    ],
  })
    .overrideGuard(ClubJwtAuthGuard)
    .useValue(withThrottler ? { canActivate: () => true } : guardStub)
    .overrideInterceptor(ClubCurrentContextInterceptor)
    .useValue(interceptorStub);

  const fixture: TestingModule = await builder.compile();
  const app = fixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new TelemetryValidationPipe());
  if (!withThrottler) {
    app.useGlobalFilters(new AllExceptionsFilter(true));
  }
  await app.init();
  return app;
}

describe('Club check-in routes (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await buildApp();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authMode = 'ok';
    clubCheckInService.getStatus.mockResolvedValue(statusDto);
    clubCheckInService.submit.mockResolvedValue(resultDto);
  });

  afterAll(async () => {
    await app.close();
  });

  it('未登录访问 status 返回 401', async () => {
    authMode = 'anonymous';
    await request(app.getHttpServer())
      .get('/api/club/check-in/status')
      .expect(401);
  });

  it('错误 accountScope 返回 403', async () => {
    authMode = 'wrong-scope';
    await request(app.getHttpServer())
      .get('/api/club/check-in/status')
      .expect(403);
  });

  it('GET status 直接返回裸 DTO，逐字段可消费', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/club/check-in/status')
      .expect(200);

    expect(response.body).toEqual(statusDto);
    expect(typeof response.body.activityEnabled).toBe('boolean');
    expect(typeof response.body.todayCheckedIn).toBe('boolean');
    expect(response.body.serverTime).toBeGreaterThan(1_700_000_000_000);
    expect(clubCheckInService.getStatus).toHaveBeenCalledWith(context);
  });

  it('POST 空 {} 不被 forbidNonWhitelisted 拒绝', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/club/check-in')
      .send({})
      .expect(200);

    expect(response.body).toEqual(resultDto);
  });

  it('body 伪造 storeId / customerId / points 不进入权威上下文', async () => {
    await request(app.getHttpServer())
      .post('/api/club/check-in')
      .send({
        storeId: 999,
        customerId: 888,
        points: 100000,
        awardedPoints: 999,
      })
      .expect(200);

    const [passedContext] = clubCheckInService.submit.mock.calls[0] as [
      ClubCurrentContext,
      string,
    ];
    expect(passedContext.store.id).toBe(11);
    expect(passedContext.user.id).toBe(201);
    expect(passedContext).not.toHaveProperty('points');
  });

  it('业务错误码落在响应体 code，而不是仅出现在 message', async () => {
    clubCheckInService.submit.mockRejectedValue(
      buildCheckInBusinessError(CHECK_IN_ALREADY_DONE_CODE),
    );

    const response = await request(app.getHttpServer())
      .post('/api/club/check-in')
      .send({})
      .expect(400);

    expect(response.body.code).toBe(CHECK_IN_ALREADY_DONE_CODE);
    expect(response.body.message).toBe('今日已签到');
  });

  it('Swagger 文档包含两个签到路径', () => {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().setTitle('check-in').build(),
    );
    const paths = Object.keys(document.paths ?? {});
    expect(paths.some((path) => path.endsWith('/club/check-in/status'))).toBe(
      true,
    );
    expect(paths.some((path) => path.endsWith('/club/check-in'))).toBe(true);
  });

  describe('方法级限流', () => {
    let limitedApp: INestApplication;

    beforeAll(async () => {
      limitedApp = await buildApp(true);
      clubCheckInService.submit.mockResolvedValue(resultDto);
    });

    afterAll(async () => {
      await limitedApp.close();
    });

    it('60 秒内第 11 次提交返回 429', async () => {
      for (let index = 0; index < 10; index += 1) {
        await request(limitedApp.getHttpServer())
          .post('/api/club/check-in')
          .send({})
          .expect(200);
      }
      await request(limitedApp.getHttpServer())
        .post('/api/club/check-in')
        .send({})
        .expect(429);
    });
  });
});
