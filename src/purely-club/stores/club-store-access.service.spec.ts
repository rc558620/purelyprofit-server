import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import { ClubMemberBindingService } from './club-member-binding.service';

describe('ClubStoreAccessService', () => {
  let service: ClubStoreAccessService;

  const prismaService = {
    store: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
    },
  };

  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
  };

  const inviteCodeMapService = {
    findStoreByInviteCode: jest.fn(),
  };

  const inviteAttributionService = {
    logInviteScan: jest.fn(),
    resolveIssueScanAttribution: jest.fn(),
    incrementIssueJoinedCount: jest.fn(),
  };

  const memberBindingService = {
    upsertMemberAndCustomer: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubStoreAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: ClubInviteCodeMapService, useValue: inviteCodeMapService },
        {
          provide: ClubInviteAttributionService,
          useValue: inviteAttributionService,
        },
        { provide: ClubMemberBindingService, useValue: memberBindingService },
      ],
    }).compile();

    service = module.get(ClubStoreAccessService);
  });

  it('可正常注入依赖', () => {
    expect(service).toBeDefined();
  });

  describe('ensureStoreMembership', () => {
    const wechatUser: AuthenticatedUser = {
      id: 301,
      email: 'club_wechat_oOPENID123@purelyprofit.local',
      phone: 'club_wechat:oOPENID123',
      name: '微信昵称',
      createdAt: new Date('2026-05-12T00:00:00.000Z'),
      updatedAt: new Date('2026-05-13T00:00:00.000Z'),
      lastActiveAt: null,
      accountScope: 'purely_club',
      currentMembership: null,
    };

    it('无手机号用户以 openid 占位 phone 建档案，并传 clubUserId 复用营销档案', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 37 });
      memberBindingService.upsertMemberAndCustomer.mockResolvedValue({
        isNewMember: true,
      });

      await expect(
        service.ensureStoreMembership(wechatUser, 37),
      ).resolves.toEqual({ isNewMember: true });

      expect(memberBindingService.upsertMemberAndCustomer).toHaveBeenCalledWith(
        37,
        'club_wechat:oOPENID123',
        '微信昵称',
        301,
      );
    });

    it('补齐会员关系后清除可访问门店缓存，否则 60 秒内仍读不到该门店', async () => {
      prismaService.store.findFirst.mockResolvedValue({ id: 37 });
      memberBindingService.upsertMemberAndCustomer.mockResolvedValue({
        isNewMember: false,
      });

      await service.ensureStoreMembership(wechatUser, 37);

      expect(redisService.del).toHaveBeenCalledWith(
        'club:accessible-stores:301',
      );
    });

    it('门店不存在时抛出 NotFoundException，且不写入档案', async () => {
      prismaService.store.findFirst.mockResolvedValue(null);

      await expect(
        service.ensureStoreMembership(wechatUser, 9999),
      ).rejects.toThrow(NotFoundException);

      expect(
        memberBindingService.upsertMemberAndCustomer,
      ).not.toHaveBeenCalled();
      expect(redisService.del).not.toHaveBeenCalled();
    });
  });
});
