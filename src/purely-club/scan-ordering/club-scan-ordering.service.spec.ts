import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { ClubScanOrderingService } from './club-scan-ordering.service';
import { ClubScanOrderingMenuQueryService } from './club-scan-ordering-menu-query.service';
import { ClubScanOrderingServiceCallService } from './club-scan-ordering-service-call.service';

/**
 * C 端扫码解析测试。
 *
 * 覆盖 resolveQrToken() 的核心业态保护场景：
 * 1. 餐饮门店 + 有效二维码 → 成功返回扫码 token
 * 2. 非餐饮门店 + 有效历史二维码 → 拒绝、不写入 Redis
 * 3. 门店不存在 → 拒绝
 * 4. 桌台禁用/清台中 → 拒绝
 * 5. 无效/过期二维码 → 拒绝
 */
describe('ClubScanOrderingService - resolveQrToken', () => {
  let service: ClubScanOrderingService;

  const prismaService = {
    scanOrderingTableQrCode: {
      findFirst: jest.fn(),
    },
    scanOrderingTable: {
      findFirst: jest.fn(),
    },
    store: {
      findUnique: jest.fn(),
    },
    scanOrderingSession: {
      findFirst: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const serviceCallService = {
    createFromScanOrdering: jest.fn(),
  };

  const menuQueryService = {
    resolveActiveMenuContext: jest.fn(),
  };

  const storeAccessService = {
    ensureStoreMembership: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: ClubScanOrderingServiceCallService,
          useValue: serviceCallService,
        },
        {
          provide: ClubScanOrderingMenuQueryService,
          useValue: menuQueryService,
        },
        {
          provide: ClubStoreAccessService,
          useValue: storeAccessService,
        },
      ],
    }).compile();
    service = module.get<ClubScanOrderingService>(ClubScanOrderingService);
  });

  const buildQrCodeResult = (overrides: Record<string, unknown> = {}) => ({
    storeId: 100,
    tableId: 1,
    table: {
      tableCode: 'T001',
      name: '1号桌',
      capacity: 4,
      status: 'available',
      area: { name: '大厅' },
    },
    ...overrides,
  });

  describe('餐饮门店 + 有效二维码', () => {
    it('成功返回扫码 token', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue(
        buildQrCodeResult(),
      );
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      const result = await service.resolveQrToken('valid-qr-token');

      expect(result).toHaveProperty('scanToken');
      expect(result).toHaveProperty('store.id', 100);
      expect(result).toHaveProperty('table.id', 1);
      expect(result).toHaveProperty('table.canOrder', true);
      expect(redisService.set).toHaveBeenCalledWith(
        expect.stringContaining('club:scan-ordering:token:'),
        expect.any(String),
        expect.any(Number),
      );
    });
  });

  describe('非餐饮门店 + 有效历史二维码', () => {
    it('抛出拒绝异常，不写入 Redis scan token', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue(
        buildQrCodeResult(),
      );
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'general',
      });

      await expect(
        service.resolveQrToken('valid-old-qr-token'),
      ).rejects.toThrow(NotFoundException);

      expect(redisService.set).not.toHaveBeenCalled();
    });
  });

  describe('门店不存在', () => {
    it('抛出拒绝异常', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue(
        buildQrCodeResult({ storeId: 9999 }),
      );
      prismaService.store.findUnique.mockResolvedValue(null);

      await expect(service.resolveQrToken('valid-qr-token')).rejects.toThrow(
        NotFoundException,
      );

      expect(redisService.set).not.toHaveBeenCalled();
    });
  });

  describe('桌台禁用/清台中', () => {
    it('桌台禁用时抛出 ConflictException', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue(
        buildQrCodeResult({
          table: {
            tableCode: 'T001',
            name: '1号桌',
            capacity: 4,
            status: 'disabled',
            area: { name: '大厅' },
          },
        }),
      );
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(service.resolveQrToken('valid-qr-token')).rejects.toThrow(
        ConflictException,
      );

      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('桌台清台中时抛出 ConflictException', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue(
        buildQrCodeResult({
          table: {
            tableCode: 'T001',
            name: '1号桌',
            capacity: 4,
            status: 'clearing',
            area: { name: '大厅' },
          },
        }),
      );
      prismaService.store.findUnique.mockResolvedValue({
        businessMode: 'catering',
      });

      await expect(service.resolveQrToken('valid-qr-token')).rejects.toThrow(
        ConflictException,
      );
    });
  });

  describe('无效/过期二维码', () => {
    it('二维码不存在时抛出 NotFoundException', async () => {
      prismaService.scanOrderingTableQrCode.findFirst.mockResolvedValue(null);

      await expect(service.resolveQrToken('invalid-qr-token')).rejects.toThrow(
        NotFoundException,
      );

      expect(prismaService.store.findUnique).not.toHaveBeenCalled();
      expect(redisService.set).not.toHaveBeenCalled();
    });
  });

  describe('createOrRestoreSession - 补齐门店会员关系', () => {
    const user: AuthenticatedUser = {
      id: 215,
      email: 'club_wechat_o6Al43fTTP77c@purelyprofit.local',
      phone: 'club_wechat:o6Al43fTTP77c',
      name: null,
      createdAt: new Date('2026-09-18T00:00:00.000Z'),
      updatedAt: new Date('2026-09-18T00:00:00.000Z'),
      lastActiveAt: null,
      accountScope: 'purely_club',
      currentMembership: null,
    };

    const prepareSessionCreation = (): void => {
      redisService.get.mockResolvedValue(
        JSON.stringify({ storeId: 100, tableId: 1 }),
      );
      prismaService.scanOrderingTable.findFirst.mockResolvedValue({
        id: 1,
        tableCode: 'T001',
        name: '1号桌',
        capacity: 4,
        status: 'available',
        area: { name: '大厅' },
        type: null,
      });
      prismaService.scanOrderingSession.updateMany.mockResolvedValue({
        count: 0,
      });
      prismaService.scanOrderingSession.findFirst.mockResolvedValue(null);
      prismaService.scanOrderingSession.create.mockResolvedValue({
        id: 295,
        guestCount: 1,
        status: 'active',
        expiresAt: new Date(),
        diningRoundId: '7f1c2f52-7a1f-4a1e-9f2a-3f0a1b2c3d4e',
      });
    };

    it('按桌码门店补齐会员关系，否则商家端看不到顾客且以当前门店为前提的接口会 404', async () => {
      prepareSessionCreation();
      storeAccessService.ensureStoreMembership.mockResolvedValue({
        isNewMember: true,
      });

      await service.createOrRestoreSession(user, { scanToken: 'scan-token' });

      expect(storeAccessService.ensureStoreMembership).toHaveBeenCalledWith(
        user,
        100,
      );
    });

    it('会员关系补齐失败时直接失败，不创建会话', async () => {
      prepareSessionCreation();
      storeAccessService.ensureStoreMembership.mockRejectedValue(
        new NotFoundException('门店不存在'),
      );

      await expect(
        service.createOrRestoreSession(user, { scanToken: 'scan-token' }),
      ).rejects.toThrow(NotFoundException);

      expect(prismaService.scanOrderingSession.create).not.toHaveBeenCalled();
    });
  });
});
