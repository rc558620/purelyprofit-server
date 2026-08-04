import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { MarketingSharedService } from './marketing-shared.service';
import { MarketingInviteQrIssueService } from './marketing-invite-qr-issue.service';

jest.mock('qrcode', () => ({
  toDataURL: jest.fn(async () => 'data:image/png;base64,QR_IMAGE'),
}));

describe('MarketingInviteQrIssueService', () => {
  let service: MarketingInviteQrIssueService;
  let configService: { get: jest.Mock };
  let prisma: {
    storeInviteCode: { findFirst: jest.Mock };
    storeInviteQrIssue: {
      create: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
      delete: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let marketingSharedService: {
    resolveMembershipManagedStoreId: jest.Mock;
    ensureMarketingStoreAccess: jest.Mock;
  };

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
    configService = { get: jest.fn().mockReturnValue('') };
    prisma = {
      storeInviteCode: {
        findFirst: jest.fn(),
      },
      storeInviteQrIssue: {
        create: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
      },
      $transaction: jest.fn().mockImplementation(async (arr: Promise<unknown>[]) =>
        Promise.all(arr),
      ),
    };
    marketingSharedService = {
      resolveMembershipManagedStoreId: jest.fn().mockResolvedValue(18),
      ensureMarketingStoreAccess: jest.fn().mockResolvedValue(undefined),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MarketingInviteQrIssueService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: configService },
        { provide: MarketingSharedService, useValue: marketingSharedService },
      ],
    }).compile();

    service = module.get(MarketingInviteQrIssueService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('createIssue', () => {
    it('未配置公共域名时拒绝创建渠道二维码', async () => {
      configService.get.mockReturnValue('');

      await expect(
        service.createIssue(user, 18, { channel: 'poster', name: '开业海报' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.storeInviteQrIssue.create).not.toHaveBeenCalled();
    });

    it('创建成功：生成带 token 的稳定入口 URL 与二维码图', async () => {
      configService.get.mockImplementation((key: string) =>
        key === 'club.publicBaseUrl' ? 'https://club.purelyprofit.com' : '/i',
      );
      prisma.storeInviteCode.findFirst.mockResolvedValue({
        id: 5,
        code: 'AB23CD45',
      });
      prisma.storeInviteQrIssue.create.mockResolvedValue({
        id: 1,
        publicToken: 'abc12345-6789-4def-0123-456789abcdef',
        channel: 'poster',
        name: '开业海报',
        status: 'active',
        scanCount: 0,
        joinedCount: 0,
        issuedAt: new Date('2026-08-04T00:00:00.000Z'),
        revokedAt: null,
      });

      const result = await service.createIssue(user, 18, {
        channel: 'poster',
        name: '开业海报',
      });

      expect(prisma.storeInviteQrIssue.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          storeId: 18,
          inviteCodeId: 5,
          channel: 'poster',
          name: '开业海报',
          protocolVersion: 'v1',
          createdBy: 1,
        }),
      });
      expect(result.entryUrl).toBe(
        'https://club.purelyprofit.com/i/v1/AB23CD45?t=abc12345-6789-4def-0123-456789abcdef',
      );
      expect(result.qrCodeImageUrl).toBe('data:image/png;base64,QR_IMAGE');
    });
  });

  describe('listIssues', () => {
    it('分页返回发行记录与总数', async () => {
      prisma.storeInviteQrIssue.findMany.mockResolvedValue([
        {
          id: 1,
          publicToken: 'token-1',
          channel: 'staff',
          name: '王小明',
          status: 'active',
          scanCount: 10,
          joinedCount: 2,
          issuedAt: new Date(),
          revokedAt: null,
          inviteCode: { code: 'AB23CD45' },
        },
      ]);
      prisma.storeInviteQrIssue.count.mockResolvedValue(1);
      configService.get.mockImplementation((key: string) =>
        key === 'club.publicBaseUrl' ? 'https://club.purelyprofit.com' : '/i',
      );

      const result = await service.listIssues(user, 18, {
        channel: 'staff',
        page: 1,
        pageSize: 20,
      });

      expect(result.total).toBe(1);
      expect(result.items[0]).toMatchObject({
        id: 1,
        channel: 'staff',
        status: 'active',
        inviteCode: 'AB23CD45',
      });
    });
  });

  describe('revokeIssue', () => {
    it('撤销生效中的渠道二维码', async () => {
      prisma.storeInviteQrIssue.findFirst.mockResolvedValue({
        id: 7,
        status: 'active',
      });

      await service.revokeIssue(user, 18, 7);

      expect(prisma.storeInviteQrIssue.update).toHaveBeenCalledWith({
        where: { id: 7 },
        data: expect.objectContaining({
          status: 'revoked',
          revokedAt: expect.any(Date),
        }),
      });
    });

    it('已撤销的二维码重复撤销时报错', async () => {
      prisma.storeInviteQrIssue.findFirst.mockResolvedValue({
        id: 7,
        status: 'revoked',
      });

      await expect(service.revokeIssue(user, 18, 7)).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('非本门店发行记录不可撤销', async () => {
      prisma.storeInviteQrIssue.findFirst.mockResolvedValue(null);

      await expect(service.revokeIssue(user, 18, 99)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });
  });

  describe('deleteIssue', () => {
    it('物理删除本门店渠道二维码', async () => {
      prisma.storeInviteQrIssue.findFirst.mockResolvedValue({ id: 7 });

      await service.deleteIssue(user, 18, 7);

      expect(prisma.storeInviteQrIssue.delete).toHaveBeenCalledWith({
        where: { id: 7 },
      });
    });

    it('非本门店发行记录不可删除', async () => {
      prisma.storeInviteQrIssue.findFirst.mockResolvedValue(null);

      await expect(service.deleteIssue(user, 18, 99)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(prisma.storeInviteQrIssue.delete).not.toHaveBeenCalled();
    });
  });
});
