import { NotFoundException } from '@nestjs/common';
import type { ArgumentsHost } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { AllExceptionsFilter } from '../../bootstrap/all-exceptions.filter';
import { RedisService } from '../../redis/redis.service';
import { ClubStoreAccessService } from './club-store-access.service';
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

  const redisService = {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  };

  const clubStoreAccessService = {
    findAccessibleStores: jest.fn(),
    findAccessibleStoreById: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubCurrentStoreContextService,
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
      clubStoreAccessService.findAccessibleStores.mockResolvedValue([]);
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
      clubStoreAccessService.findAccessibleStores.mockResolvedValue(stores);
      redisService.get.mockResolvedValue('37');

      await expect(service.getCurrentStore(user)).resolves.toEqual(stores[1]);
      expect(redisService.del).not.toHaveBeenCalled();
    });
  });
});
