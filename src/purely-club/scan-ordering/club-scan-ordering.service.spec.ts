import { ConflictException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { ClubScanOrderingService } from './club-scan-ordering.service';

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
    store: {
      findUnique: jest.fn(),
    },
    scanOrderingSession: {
      findFirst: jest.fn(),
    },
  };

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    exists: jest.fn(),
  };

  const realtimeService = {
    publishServiceCallCreated: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubScanOrderingService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        {
          provide: ScanOrderingRealtimeService,
          useValue: realtimeService,
        },
      ],
    }).compile();
    service = module.get<ClubScanOrderingService>(ClubScanOrderingService);
  });

  const buildQrCodeResult = (overrides: any = {}) => ({
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
});
