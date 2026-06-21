import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';
import { AuthAccountMembershipService } from '../src/purely-profit/auth/auth-account-membership.service';
import { AuthSessionService } from '../src/purely-profit/auth/auth-session.service';
import { ClubJwtAuthGuard } from '../src/purely-profit/auth/guards/jwt-auth.guard';
import {
  type AuthenticatedUser,
  JwtStrategy,
} from '../src/purely-profit/auth/strategies/jwt.strategy';
import { ClubMemberController } from '../src/purely-club/member/club-member.controller';
import { ClubMemberService } from '../src/purely-club/member/club-member.service';
import { ClubCurrentStoreContextService } from '../src/purely-club/stores/club-current-store-context.service';
import { PrismaService } from '../src/prisma/prisma.service';

const TEST_JWT_SECRET = 'club-member-test-secret';
const jwtService = new JwtService({ secret: TEST_JWT_SECRET });

describe('Club member profile routes (e2e)', () => {
  let app: INestApplication<App>;

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
  };

  const authAccountMembershipService = {
    ensureUserNotBanned: jest.fn(),
    resolveAuthenticatedMembership: jest.fn(),
  };

  const authSessionService = {
    getTokenVersion: jest.fn(),
  };

  const clubMemberService = {
    getProfile: jest.fn(),
    changePassword: jest.fn(),
    updateAvatar: jest.fn(),
    updateNickname: jest.fn(),
  };

  const clubCurrentStoreContextService = {
    resolveCurrentContext: jest.fn(),
  };

  const clubUserRecord = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
      controllers: [ClubMemberController],
      providers: [
        JwtStrategy,
        ClubJwtAuthGuard,
        {
          provide: ClubMemberService,
          useValue: clubMemberService,
        },
        {
          provide: PrismaService,
          useValue: prismaService,
        },
        {
          provide: ClubCurrentStoreContextService,
          useValue: clubCurrentStoreContextService,
        },
        {
          provide: AuthAccountMembershipService,
          useValue: authAccountMembershipService,
        },
        {
          provide: AuthSessionService,
          useValue: authSessionService,
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn((key: string) => {
              if (key === 'jwt.secret') {
                return TEST_JWT_SECRET;
              }
              if (key === 'pulse.devAccountEmails') {
                return [];
              }
              return undefined;
            }),
          },
        },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    authAccountMembershipService.ensureUserNotBanned.mockResolvedValue(
      undefined,
    );
    authAccountMembershipService.resolveAuthenticatedMembership.mockResolvedValue(
      null,
    );
    authSessionService.getTokenVersion.mockResolvedValue(0);
    prismaService.user.findUnique.mockResolvedValue(clubUserRecord);
    clubCurrentStoreContextService.resolveCurrentContext.mockResolvedValue({
      user: {
        id: 201,
        email: 'club_phone_13800138000@purelyprofit.local',
        phone: '13800138000',
        name: '俱乐部用户',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
        lastActiveAt: null,
        accountScope: 'purely_club',
        currentMembership: null,
      },
      store: {
        id: 11,
        name: '望京旗舰店',
        address: '北京市朝阳区望京 SOHO T3 B1',
        createdAt: new Date('2026-05-12T00:00:00.000Z'),
        updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      },
    });
    clubMemberService.getProfile.mockResolvedValue({
      id: '201',
      phone: '13800138000',
      nickname: '俱乐部用户',
      avatar: 'https://cdn.example.com/avatar.png',
    });
    clubMemberService.changePassword.mockResolvedValue({
      message: '密码修改成功，旧登录态已失效',
      access_token: 'club-next-token',
    });
    clubMemberService.updateAvatar.mockResolvedValue({
      id: '201',
      phone: '13800138000',
      nickname: '俱乐部用户',
      avatar: 'https://cdn.example.com/avatar-new.png',
    });
    clubMemberService.updateNickname.mockResolvedValue({
      id: '201',
      phone: '13800138000',
      nickname: '新昵称',
      avatar: 'https://cdn.example.com/avatar.png',
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/club/member/profile 未登录时返回 401', async () => {
    await request(app.getHttpServer())
      .get('/api/club/member/profile')
      .expect(401);
  });

  it('GET /api/club/member/profile 返回当前 purely-club 用户资料', async () => {
    await request(app.getHttpServer())
      .get('/api/club/member/profile')
      .set('Authorization', `Bearer ${createToken()}`)
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          id: '201',
          phone: '13800138000',
          nickname: '俱乐部用户',
          avatar: 'https://cdn.example.com/avatar.png',
        });
      });

    expect(clubMemberService.getProfile).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AuthenticatedUser>>({
        id: 201,
        phone: '13800138000',
        accountScope: 'purely_club',
      }),
    );
  });

  it('POST /api/club/member/change-password 调用当前密码修改链路', async () => {
    await request(app.getHttpServer())
      .post('/api/club/member/change-password')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
        confirmPassword: 'newPassword123',
      })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          message: '密码修改成功，旧登录态已失效',
          access_token: 'club-next-token',
        });
      });

    expect(clubMemberService.changePassword).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AuthenticatedUser>>({
        id: 201,
        accountScope: 'purely_club',
      }),
      {
        currentPassword: 'oldPassword123',
        newPassword: 'newPassword123',
        confirmPassword: 'newPassword123',
      },
    );
  });

  it('POST /api/club/member/change-password 密码长度不足时返回 400', async () => {
    await request(app.getHttpServer())
      .post('/api/club/member/change-password')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({
        currentPassword: '123',
        newPassword: '456',
      })
      .expect(400);

    expect(clubMemberService.changePassword).not.toHaveBeenCalled();
  });

  it('PATCH /api/club/member/profile/avatar 返回更新后的头像资料', async () => {
    await request(app.getHttpServer())
      .patch('/api/club/member/profile/avatar')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ avatar: 'https://cdn.example.com/avatar-new.png' })
      .expect(200)
      .expect(({ body }) => {
        expect(body).toEqual({
          id: '201',
          phone: '13800138000',
          nickname: '俱乐部用户',
          avatar: 'https://cdn.example.com/avatar-new.png',
        });
      });

    expect(clubMemberService.updateAvatar).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AuthenticatedUser>>({
        id: 201,
        accountScope: 'purely_club',
      }),
      {
        avatar: 'https://cdn.example.com/avatar-new.png',
      },
    );
  });

  it('PATCH /api/club/member/profile/nickname 会裁剪空白并返回更新后的昵称资料', async () => {
    await request(app.getHttpServer())
      .patch('/api/club/member/profile/nickname')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ nickname: '  新昵称  ' })
      .expect(200)
      .expect(({ body }) => {
        expect(body.nickname).toBe('新昵称');
      });

    expect(clubMemberService.updateNickname).toHaveBeenCalledWith(
      expect.objectContaining<Partial<AuthenticatedUser>>({
        id: 201,
        accountScope: 'purely_club',
      }),
      {
        nickname: '新昵称',
      },
    );
  });

  it('PATCH /api/club/member/profile/nickname 超长昵称时返回 400', async () => {
    await request(app.getHttpServer())
      .patch('/api/club/member/profile/nickname')
      .set('Authorization', `Bearer ${createToken()}`)
      .send({ nickname: '这是一个超过二十个字符长度限制的昵称内容示例' })
      .expect(400);

    expect(clubMemberService.updateNickname).not.toHaveBeenCalled();
  });
});

function createToken(
  accountScope: 'purely_club' | 'purely_profit' = 'purely_club',
): string {
  return jwtService.sign({
    sub: 201,
    phone: '13800138000',
    accountScope,
    sessionVersion: 0,
  });
}
