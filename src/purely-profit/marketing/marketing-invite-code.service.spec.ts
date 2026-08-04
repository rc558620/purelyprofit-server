import { ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { StoreInviteCodeService } from '../stores/store-invite-code.service';
import { MarketingInviteCodeService } from './marketing-invite-code.service';
import { MarketingSharedService } from './marketing-shared.service';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,QR_IMAGE'),
}));

describe('MarketingInviteCodeService', () => {
  let service: MarketingInviteCodeService;
  let prisma: { storeInviteCode: { findFirst: jest.Mock } };
  let marketingSharedService: {
    resolveMembershipManagedStoreId: jest.Mock;
    ensureMarketingStoreAccess: jest.Mock;
  };
  let inviteCodeService: {
    regenerateForStore: jest.Mock;
    deactivateForStore: jest.Mock;
  };
  let configService: { get: jest.Mock };

  const user: AuthenticatedUser = {
    id: 1,
    email: 'boss@example.com',
    phone: '13800138000',
    name: '老板',
    createdAt: new Date(),
    updatedAt: new Date(),
    lastActiveAt: null,
    currentMembership: {
      staffId: 8,
      storeId: 18,
      role: 'owner',
      permissions: ['*'],
      isActive: true,
      subjectType: 'owner',
      linkedEmployeeId: null,
      subAccountId: null,
      subAccountRole: null,
      subAccountStatus: null,
      subAccountAssigned: false,
      canAccessHome: true,
      canUseHandover: true,
    },
  };

  beforeEach(async () => {
    prisma = {
      storeInviteCode: {
        findFirst: jest.fn(),
      },
    };
    marketingSharedService = {
      resolveMembershipManagedStoreId: jest.fn(),
      ensureMarketingStoreAccess: jest.fn().mockResolvedValue(undefined),
    };
    inviteCodeService = {
      regenerateForStore: jest.fn(),
      deactivateForStore: jest.fn().mockResolvedValue(undefined),
    };
    configService = {
      get: jest.fn().mockReturnValue(''),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingInviteCodeService,
        { provide: PrismaService, useValue: prisma },
        { provide: MarketingSharedService, useValue: marketingSharedService },
        { provide: StoreInviteCodeService, useValue: inviteCodeService },
        { provide: ConfigService, useValue: configService },
      ],
    }).compile();

    service = module.get(MarketingInviteCodeService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('getInviteCode', () => {
    it('门店有有效邀请码时返回邀请码与二维码图', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(18);
      prisma.storeInviteCode.findFirst.mockResolvedValue({ code: 'AB23CD45' });

      const result = await service.getInviteCode(user, 18);

      expect(prisma.storeInviteCode.findFirst).toHaveBeenCalledWith({
        where: { storeId: 18, isActive: true },
        select: { code: true },
        orderBy: { createdAt: 'desc' },
      });
      expect(result).toEqual({
        inviteCode: 'AB23CD45',
        inviteCodeQrCodeImageUrl: 'data:image/png;base64,QR_IMAGE',
        isActive: true,
        inviteQrPayloadVersion: 'legacy',
        inviteQrEntryUrl: null,
      });
    });

    it('配置公共域名时返回 v1 载荷版本与可复制稳定入口 URL', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'club.publicBaseUrl' ? 'https://club.purelyprofit.com' : '',
      );
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(18);
      prisma.storeInviteCode.findFirst.mockResolvedValue({ code: 'AB23CD45' });

      const result = await service.getInviteCode(user, 18);

      expect(result).toEqual({
        inviteCode: 'AB23CD45',
        inviteCodeQrCodeImageUrl: 'data:image/png;base64,QR_IMAGE',
        isActive: true,
        inviteQrPayloadVersion: 'v1',
        inviteQrEntryUrl: 'https://club.purelyprofit.com/i/v1/AB23CD45',
      });
    });

    it('门店无有效邀请码时返回空态', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(18);
      prisma.storeInviteCode.findFirst.mockResolvedValue(null);

      const result = await service.getInviteCode(user, 18);

      expect(result).toEqual({
        inviteCode: null,
        inviteCodeQrCodeImageUrl: null,
        isActive: false,
        inviteQrPayloadVersion: null,
        inviteQrEntryUrl: null,
      });
    });

    it('无权访问门店时返回空态且不查库', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(null);

      const result = await service.getInviteCode(user);

      expect(prisma.storeInviteCode.findFirst).not.toHaveBeenCalled();
      expect(result.isActive).toBe(false);
    });
  });

  describe('rotateInviteCode', () => {
    it('轮换成功后返回新码与二维码图', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(18);
      inviteCodeService.regenerateForStore.mockResolvedValue('XY56ZW78');

      const result = await service.rotateInviteCode(user, 18);

      expect(marketingSharedService.ensureMarketingStoreAccess).toHaveBeenCalledWith(
        user,
        18,
        'marketing:manage',
      );
      expect(inviteCodeService.regenerateForStore).toHaveBeenCalledWith(18);
      expect(result).toEqual({
        inviteCode: 'XY56ZW78',
        inviteCodeQrCodeImageUrl: 'data:image/png;base64,QR_IMAGE',
        isActive: true,
        inviteQrPayloadVersion: 'legacy',
        inviteQrEntryUrl: null,
      });
    });

    it('无管理权限时拒绝轮换', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(null);

      await expect(service.rotateInviteCode(user, 18)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(inviteCodeService.regenerateForStore).not.toHaveBeenCalled();
    });
  });

  describe('deactivateInviteCode', () => {
    it('停用成功并返回空态', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(18);

      const result = await service.deactivateInviteCode(user, 18);

      expect(inviteCodeService.deactivateForStore).toHaveBeenCalledWith(18);
      expect(result).toEqual({
        inviteCode: null,
        inviteCodeQrCodeImageUrl: null,
        isActive: false,
        inviteQrPayloadVersion: null,
        inviteQrEntryUrl: null,
      });
    });

    it('无管理权限时拒绝停用', async () => {
      marketingSharedService.resolveMembershipManagedStoreId.mockResolvedValue(18);
      marketingSharedService.ensureMarketingStoreAccess.mockRejectedValue(
        new ForbiddenException('无权操作'),
      );

      await expect(service.deactivateInviteCode(user, 18)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(inviteCodeService.deactivateForStore).not.toHaveBeenCalled();
    });
  });
});
