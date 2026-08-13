import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubInviteScanResolveService } from './club-invite-scan-resolve.service';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import { ClubStoreViewService } from './club-store-view.service';

describe('ClubInviteScanResolveService', () => {
  let service: ClubInviteScanResolveService;

  const prismaService = {
    member: {
      findFirst: jest.fn(),
    },
  };

  const storeViewService = {
    toSummary: jest.fn(),
  };

  const inviteCodeMapService = {
    findStoreByInviteCode: jest.fn(),
  };

  const inviteAttributionService = {
    logInviteScan: jest.fn(),
    resolveIssueScanAttribution: jest.fn(),
    incrementIssueJoinedCount: jest.fn(),
  };

  const user: AuthenticatedUser = {
    id: 201,
    email: 'club_phone_13800138000@purelyprofit.local',
    phone: '13800138000',
    name: '俱乐部用户',
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };

  const storeRecord = {
    id: 18,
    name: '望京旗舰店',
    address: '北京市朝阳区望京 SOHO T3 B1',
    businessMode: 'general' as const,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-13T00:00:00.000Z'),
  };

  const storeSummary = {
    id: 18,
    name: '望京旗舰店',
    address: '北京市朝阳区望京 SOHO T3 B1',
    businessMode: 'general',
    isOpen: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // 默认 inviteCode→storeId 映射缓存未命中，走全量加载
    inviteCodeMapService.findStoreByInviteCode.mockResolvedValue(storeRecord);
    inviteAttributionService.resolveIssueScanAttribution.mockResolvedValue({
      continueScan: true,
    });
    storeViewService.toSummary.mockResolvedValue(storeSummary);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubInviteScanResolveService,
        { provide: PrismaService, useValue: prismaService },
        { provide: ClubStoreViewService, useValue: storeViewService },
        { provide: ClubInviteCodeMapService, useValue: inviteCodeMapService },
        {
          provide: ClubInviteAttributionService,
          useValue: inviteAttributionService,
        },
      ],
    }).compile();

    service = module.get(ClubInviteScanResolveService);
  });

  describe('resolveScanCode', () => {
    it('v1 URL 且用户未加入时返回 active + join_store', async () => {
      prismaService.member.findFirst.mockResolvedValue(null);

      const result = await service.resolveScanCode(
        user,
        'https://club.purelyprofit.com/i/v1/AB23CD45',
      );

      expect(result).toEqual({
        protocolVersion: 'v1',
        inviteCode: 'AB23CD45',
        store: storeSummary,
        status: 'active',
        nextAction: 'join_store',
        message: '扫码成功，可加入该门店',
      });
    });

    it('legacy 裸邀请码且用户已加入时返回 active + already_bound', async () => {
      prismaService.member.findFirst.mockResolvedValue({ id: 99 });

      const result = await service.resolveScanCode(user, 'AB23CD45');

      expect(result.protocolVersion).toBe('legacy');
      expect(result.status).toBe('active');
      expect(result.nextAction).toBe('already_bound');
      expect(prismaService.member.findFirst).toHaveBeenCalledWith({
        where: { storeId: 18, phone: '13800138000', deletedAt: null },
        select: { id: true },
      });
    });

    it('邀请码不存在或已停用时返回 inactive', async () => {
      inviteCodeMapService.findStoreByInviteCode.mockResolvedValue(null);

      const result = await service.resolveScanCode(user, 'ZZZZZZZZ');

      expect(result).toEqual({
        protocolVersion: 'legacy',
        inviteCode: 'ZZZZZZZZ',
        store: null,
        status: 'inactive',
        nextAction: 'none',
        message: '该门店邀请二维码已失效，请联系商家获取新二维码',
      });
    });

    it('无法识别的扫码内容返回 not_found', async () => {
      const result = await service.resolveScanCode(user, 'not-a-store-code');

      expect(result.status).toBe('not_found');
      expect(result.protocolVersion).toBeNull();
      expect(inviteCodeMapService.findStoreByInviteCode).not.toHaveBeenCalled();
    });

    it('未知协议版本返回 unsupported_version', async () => {
      const result = await service.resolveScanCode(
        user,
        'https://club.purelyprofit.com/i/v999/AB23CD45',
      );

      expect(result.status).toBe('unsupported_version');
      expect(result.protocolVersion).toBe('unsupported');
      expect(result.inviteCode).toBeNull();
    });
  });

  describe('resolvePublicInviteEntry', () => {
    it('有效邀请码返回门店摘要与 active', async () => {
      const result = await service.resolvePublicInviteEntry('AB23CD45');

      expect(result).toEqual({
        inviteCode: 'AB23CD45',
        store: storeSummary,
        status: 'active',
        message: '邀请二维码有效',
      });
    });

    it('邀请码无效或已停用返回 inactive', async () => {
      inviteCodeMapService.findStoreByInviteCode.mockResolvedValue(null);

      const result = await service.resolvePublicInviteEntry('ZZZZZZZZ');

      expect(result.status).toBe('inactive');
      expect(result.store).toBeNull();
    });

    it('空码或非法输入返回 not_found', async () => {
      const result = await service.resolvePublicInviteEntry('not-a-code');

      expect(result.status).toBe('not_found');
      expect(result.inviteCode).toBeNull();
    });

    it('渠道二维码（带 token）扫码成功后 scanCount 递增', async () => {
      inviteAttributionService.resolveIssueScanAttribution.mockResolvedValue({
        continueScan: true,
      });

      const result = await service.resolvePublicInviteEntry(
        'AB23CD45',
        'abc12345-6789-4def-0123-456789abcdef',
      );

      expect(
        inviteAttributionService.resolveIssueScanAttribution,
      ).toHaveBeenCalledWith('abc12345-6789-4def-0123-456789abcdef', 18);
      expect(result.status).toBe('active');
      expect(result.store).toEqual(storeSummary);
    });

    it('已撤销的渠道二维码返回停用提示且不递增 scanCount', async () => {
      inviteAttributionService.resolveIssueScanAttribution.mockResolvedValue({
        continueScan: false,
      });

      const result = await service.resolvePublicInviteEntry(
        'AB23CD45',
        'abc12345-6789-4def-0123-456789abcdef',
      );

      expect(result.status).toBe('inactive');
      expect(result.store).toBeNull();
      expect(result.message).toBe('该渠道二维码已停用，请联系商家获取新二维码');
    });
  });
});
