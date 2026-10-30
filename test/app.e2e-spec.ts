import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppController } from '../src/app.controller';
import { AppService } from '../src/app.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ScanOrderingRealtimeService } from '../src/purely-club/scan-ordering/scan-ordering-realtime.service';

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  const appService = {
    getHello: jest.fn(() => 'Hello World!'),
    getHealth: jest.fn(),
    getReadiness: jest.fn(),
    getMetrics: jest.fn(),
  };

  // AppController 的 socket.io 诊断接口依赖 Prisma 与实时服务，本用例只验证 / 路由，
  // 这里提供最小 mock 满足构造器注入，避免 compile() 阶段失败
  const prismaService = {
    store: {
      findFirst: jest.fn(),
    },
  };

  const scanOrderingRealtimeService = {
    storeRoom: jest.fn((storeId: number) => `store:${storeId}`),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        { provide: AppService, useValue: appService },
        { provide: PrismaService, useValue: prismaService },
        {
          provide: ScanOrderingRealtimeService,
          useValue: scanOrderingRealtimeService,
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    appService.getHello.mockReturnValue('Hello World!');
  });

  it('/ (GET)', async () => {
    await request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect('Hello World!');

    expect(appService.getHello).toHaveBeenCalledTimes(1);
  });
});
