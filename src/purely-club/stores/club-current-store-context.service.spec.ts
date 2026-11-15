import { NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { AllExceptionsFilter } from '../../bootstrap/all-exceptions.filter';
import { RedisService } from '../../redis/redis.service';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubCurrentContextCache } from './club-current-context.cache';
import type { ClubAccessibleStoreRecord } from './club-stores.types';
import {
  ClubCurrentStoreContextService,
  CLUB_NO_ACCESSIBLE_STORE_CODE,
} from './club-current-store-context.service';

/**
 * 「无可访问门店」是一条**跨仓库契约**：
 * 后端下发业务码 → 全局过滤器透传 → purelyClub 据此执行「清缓存 + 跳门店选择页」。
 *
 * 曾经只改了前端一半（改成按 businessCode 匹配），后端始终没下发该码，
 * 导致那条兜底分支恒不命中——用户绑定手机号成功后被卡在没有出口的页面上。
 * 这里把整条链路锁住，任一端再漂就会红。
 */
describe('ClubCurrentStoreContextService', () => {
  let service: ClubCurrentStoreContextService;

  /** 构造完整的可访问门店记录：直接调用 service 时不能只给 id/name */
  const buildAccessibleStore = (
    id: number,
    name: string,
  ): ClubAccessibleStoreRecord => ({
    id,
    name,
    address: null,
    businessMode: 'general',
    memberCareEnabled: false,
    createdAt: new Date('2026-05-12T00:00:00.000Z'),
    updatedAt: new Date('2026-05-12T00:00:00.000Z'),
  });

  const user: AuthenticatedUser = {
    id: 215,
    email: 'club_wechat_oOPENID123@purelyprofit.local',
    phone: '15919654010',
    name: '纯利会员4010',
    createdAt: new Date('2026-09-17T00:00:00.000Z'),
    updatedAt: new Date('2026-09-18T00:00:00.000Z'),
    lastActiveAt: null,
    accountScope: 'purely_club',
    currentMembership: null,
  };

  /** get 用于 readSelectedStoreId；mget 用于合并读取上下文快照 */
  const redisService = {
    get: jest.fn(),
    mget: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const clubStoreAccessService = {
    findAccessibleStores: jest.fn(),
    findAccessibleStoreById: jest.fn(),
    buildAccessibleStoresCacheKey: jest.fn(
      (userId: number) => `club:accessible-stores:${userId}`,
    ),
    // 真实解析语义：缓存只是加速层，脏值必须能被安全判为未命中
    parseAccessibleStores: jest.fn((raw: string | null) => {
      if (raw === null) {
        return null;
      }
      try {
        const parsed = JSON.parse(raw) as unknown;
        return Array.isArray(parsed)
          ? (parsed as ClubAccessibleStoreRecord[])
          : null;
      } catch {
        return null;
      }
    }),
    refreshAccessibleStores: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    // 默认「门店缓存未命中 + 未选店」：clearAllMocks 只清调用记录、不清实现，
    // 不复位的话某些用例设置的 mockResolvedValue 会污染后续用例。
    redisService.get.mockResolvedValue(null);
    redisService.mget.mockResolvedValue([null, null]);
    clubStoreAccessService.refreshAccessibleStores.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubCurrentStoreContextService,
        ClubCurrentContextCache,
        { provide: RedisService, useValue: redisService },
        {
          provide: ClubStoreAccessService,
          useValue: clubStoreAccessService,
        },
      ],
    }).compile();

    service = module.get(ClubCurrentStoreContextService);
  });

  it('可正常注入依赖', () => {
    expect(service).toBeDefined();
  });

  describe('无可访问门店的错误契约', () => {
    beforeEach(() => {
      clubStoreAccessService.refreshAccessibleStores.mockResolvedValue([]);
    });

    it('抛出的 404 必须携带业务码 NO_ACCESSIBLE_STORE', async () => {
      await expect(service.getCurrentStore(user)).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({
          message: '当前账号暂无可访问门店',
          code: CLUB_NO_ACCESSIBLE_STORE_CODE,
        }),
      });
    });

    it('同时清掉已失效的选店缓存，避免下次误读到不属于自己的门店', async () => {
      await expect(service.getCurrentStore(user)).rejects.toBeInstanceOf(
        NotFoundException,
      );

      expect(redisService.del).toHaveBeenCalledWith('club:selected-store:215');
    });

    it('业务码经全局过滤器后落到响应体的 code 字段 —— 前端正是读这个', async () => {
      let caught: NotFoundException | null = null;
      try {
        await service.getCurrentStore(user);
      } catch (error) {
        caught = error as NotFoundException;
      }
      expect(caught).toBeInstanceOf(NotFoundException);

      const mockResponse = {
        status: jest.fn().mockReturnThis(),
        send: jest.fn(),
      };
      const mockRequest = {
        method: 'GET',
        url: '/api/club/stores/current',
        id: 'req-123',
      };
      const mockHost = {
        switchToHttp: () => ({
          getResponse: () => mockResponse,
          getRequest: () => mockRequest,
        }),
      } as unknown as ArgumentsHost;

      new AllExceptionsFilter(true).catch(caught, mockHost);

      expect(mockResponse.send).toHaveBeenCalledWith(
        expect.objectContaining({
          statusCode: 404,
          message: '当前账号暂无可访问门店',
          code: CLUB_NO_ACCESSIBLE_STORE_CODE,
        }),
      );
    });
  });

  describe('有门店时', () => {
    it('返回选中的门店，不抛错', async () => {
      const stores = [
        { id: 9, name: '门店甲' },
        { id: 37, name: '门店乙' },
      ];
      clubStoreAccessService.refreshAccessibleStores.mockResolvedValue(stores);
      redisService.mget.mockResolvedValue([null, '37']);

      await expect(service.getCurrentStore(user)).resolves.toEqual(stores[1]);
      expect(redisService.del).not.toHaveBeenCalled();
    });

    it('仅一家门店时仍自动选中并持久化，保持老用户零感知', async () => {
      const stores = [{ id: 9, name: '门店甲' }];
      clubStoreAccessService.refreshAccessibleStores.mockResolvedValue(stores);

      await expect(service.getCurrentStore(user)).resolves.toEqual(stores[0]);
      expect(redisService.set).toHaveBeenCalledWith(
        'club:selected-store:215',
        '9',
        expect.any(Number),
      );
    });

    it('多家门店且未选店时拒绝隐式回落，携带 NO_ACCESSIBLE_STORE 业务码', async () => {
      clubStoreAccessService.refreshAccessibleStores.mockResolvedValue([
        { id: 9, name: '门店甲' },
        { id: 37, name: '门店乙' },
      ]);

      await expect(service.getCurrentStore(user)).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({
          message: '当前账号暂无可访问门店',
          code: CLUB_NO_ACCESSIBLE_STORE_CODE,
        }),
      });
      // 关键：不能把第一个门店写进选店缓存，否则前端跳到选店页后
      // 列表接口会「替用户选好」，拦截形同虚设。
      expect(redisService.set).not.toHaveBeenCalled();
    });

    it('选店缓存指向已不可访问的门店时要求重新选店，并清掉脏缓存', async () => {
      clubStoreAccessService.refreshAccessibleStores.mockResolvedValue([
        { id: 9, name: '门店甲' },
        { id: 37, name: '门店乙' },
      ]);
      redisService.mget.mockResolvedValue([null, '999']);

      await expect(service.getCurrentStore(user)).rejects.toMatchObject({
        status: 404,
        response: expect.objectContaining({
          code: CLUB_NO_ACCESSIBLE_STORE_CODE,
        }),
      });
      expect(redisService.del).toHaveBeenCalledWith('club:selected-store:215');
    });

    it('门店列表的 currentStoreId 在多门店未选店时为 null，不产生选店副作用', async () => {
      const stores: ClubAccessibleStoreRecord[] = [
        buildAccessibleStore(9, '门店甲'),
        buildAccessibleStore(37, '门店乙'),
      ];

      await expect(
        service.resolveCurrentStoreId(user.id, stores),
      ).resolves.toBeNull();
      expect(redisService.set).not.toHaveBeenCalled();
    });
  });

  describe('上下文快照的合并读取与进程内复用', () => {
    it('门店列表与选中门店合并为一次 MGET，不再各自 GET', async () => {
      const stores = [{ id: 9, name: '门店甲' }];
      redisService.mget.mockResolvedValue([JSON.stringify(stores), '9']);

      await expect(service.getCurrentStore(user)).resolves.toEqual(stores[0]);
      expect(redisService.mget).toHaveBeenCalledTimes(1);
      // 命中缓存时既不回源 DB，也不读选店 key 的独立 GET
      expect(
        clubStoreAccessService.refreshAccessibleStores,
      ).not.toHaveBeenCalled();
      expect(redisService.get).not.toHaveBeenCalled();
    });

    it('TTL 窗口内的连续请求不再触碰 Redis', async () => {
      const stores = [{ id: 9, name: '门店甲' }];
      redisService.mget.mockResolvedValue([JSON.stringify(stores), '9']);

      await service.getCurrentStore(user);
      await service.getCurrentStore(user);

      expect(redisService.mget).toHaveBeenCalledTimes(1);
    });

    it('选店缓存被清除时同步失效进程内快照，避免继续返回旧门店', async () => {
      const stores = [{ id: 9, name: '门店甲' }];
      redisService.mget.mockResolvedValue([JSON.stringify(stores), '9']);

      await service.getCurrentStore(user);
      await service.clearSelectedStoreId(user.id);
      await service.getCurrentStore(user);

      expect(redisService.mget).toHaveBeenCalledTimes(2);
    });
  });
});
