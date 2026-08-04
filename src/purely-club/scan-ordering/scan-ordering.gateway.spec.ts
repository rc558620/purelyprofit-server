import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import { AuthMembershipResolverService } from '../../purely-profit/auth/auth-membership-resolver.service';
import { ScanOrderingGateway } from './scan-ordering.gateway';
import { ScanOrderingRealtimeService } from './scan-ordering-realtime.service';
import { RedisService } from '../../redis/redis.service';
import type { AuthenticatedMembership } from '../../purely-profit/access-control/access-control.service';
import type { JwtPayload } from '../../purely-profit/auth/strategies/jwt.strategy';
import type { Socket } from 'socket.io';

/**
 * 构造一个最小可用的 Socket mock。
 * 通过 data 属性携带 identity（鉴权后由 handleConnection 写入）。
 */
function createMockSocket(
  handshake?: Partial<{
    auth: { token?: string };
    headers: { authorization?: string };
  }>,
): jest.Mocked<Socket> {
  return {
    id: 'mock-socket-id',
    data: {},
    handshake: {
      auth: handshake?.auth ?? {},
      headers: handshake?.headers ?? {},
    } as unknown as Socket['handshake'],
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  } as unknown as jest.Mocked<Socket>;
}

describe('ScanOrderingGateway', () => {
  let gateway: ScanOrderingGateway;

  const jwtService = {
    verify: jest.fn(),
  };

  const prismaService = {
    user: {
      findUnique: jest.fn(),
    },
    scanOrders: {
      findFirst: jest.fn(),
    },
    scanOrderingSession: {
      findFirst: jest.fn(),
    },
  };

  const commerceAccessService = {
    ensureCanAccessStoreWithAnyPermission: jest.fn(),
  };

  const authMembershipResolverService = {
    resolveAuthenticatedMembership: jest.fn(),
  };

  const realtimeService = {
    bindServer: jest.fn(),
    orderRoom: jest.fn((id: number) => `order:${id}`),
    sessionRoom: jest.fn((id: number) => `session:${id}`),
    storeRoom: jest.fn((id: number) => `store:${id}`),
  };

  const redisService = {
    createPubSubClients: jest.fn(() => ({
      publisher: { publish: jest.fn(), quit: jest.fn() },
      subscriber: { subscribe: jest.fn(), quit: jest.fn() },
    })),
  };

  const validPayload: JwtPayload = {
    sub: 1001,
    phone: '13800138000',
    sessionVersion: 0,
  };

  const validAccount = { email: 'clubuser@example.com' };

  const validMembership: AuthenticatedMembership = {
    staffId: 50,
    storeId: 10,
    role: 'owner',
    permissions: ['scan-ordering:view', 'scan-ordering:order-process'],
    isActive: true,
    subjectType: 'owner',
    linkedEmployeeId: null,
    subAccountId: null,
    subAccountRole: null,
    subAccountStatus: null,
    subAccountAssigned: false,
    canAccessHome: true,
    canUseHandover: true,
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    jwtService.verify.mockReturnValue(validPayload);
    prismaService.user.findUnique.mockResolvedValue(validAccount);
    authMembershipResolverService.resolveAuthenticatedMembership.mockResolvedValue(
      validMembership,
    );
    commerceAccessService.ensureCanAccessStoreWithAnyPermission.mockResolvedValue(
      undefined,
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ScanOrderingGateway,
        { provide: JwtService, useValue: jwtService },
        { provide: PrismaService, useValue: prismaService },
        { provide: CommerceAccessService, useValue: commerceAccessService },
        {
          provide: AuthMembershipResolverService,
          useValue: authMembershipResolverService,
        },
        { provide: ScanOrderingRealtimeService, useValue: realtimeService },
        { provide: RedisService, useValue: redisService },
      ],
    }).compile();

    gateway = module.get<ScanOrderingGateway>(ScanOrderingGateway);
  });

  // ──────────────────────────────────────────────────────────────
  // 连接鉴权测试
  // ──────────────────────────────────────────────────────────────

  describe('连接鉴权', () => {
    // ── 1. 无 token 连接被拒绝 ──────────────────────────────────

    it('1. 无 token 连接被拒绝', async () => {
      const client = createMockSocket({ auth: {}, headers: {} });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('connection_error', {
        message: '认证失败，请重新登录',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.identity).toBeUndefined();
    });

    // ── 2. 非法 token 连接被拒绝 ────────────────────────────────

    it('2. 非法 token 连接被拒绝', async () => {
      jwtService.verify.mockImplementation(() => {
        throw new Error('invalid token');
      });
      const client = createMockSocket({
        auth: { token: 'invalid-token' },
      });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('connection_error', {
        message: '认证失败，请重新登录',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.identity).toBeUndefined();
    });

    // ── 3. 用户不存在时连接被拒绝 ──────────────────────────────

    it('3. 用户不存在时连接被拒绝', async () => {
      prismaService.user.findUnique.mockResolvedValue(null);
      const client = createMockSocket({
        auth: { token: 'valid-but-user-deleted' },
      });

      await gateway.handleConnection(client);

      expect(client.emit).toHaveBeenCalledWith('connection_error', {
        message: '认证失败，请重新登录',
      });
      expect(client.disconnect).toHaveBeenCalledWith(true);
      expect(client.data.identity).toBeUndefined();
    });

    // ── 合法 token 连接成功，写入 identity ─────────────────────

    it('合法 token 连接成功时写入 identity 并不断开连接', async () => {
      const client = createMockSocket({
        auth: { token: 'valid-token' },
      });

      await gateway.handleConnection(client);

      expect(client.emit).not.toHaveBeenCalled();
      expect(client.disconnect).not.toHaveBeenCalled();
      expect(client.data.identity).toEqual({
        userId: 1001,
        email: 'clubuser@example.com',
        phone: '13800138000',
        currentMembership: validMembership,
      });
    });

    // ── 支持 Authorization: Bearer 头部传递 token ──────────────

    it('支持 Authorization: Bearer 头部传递 token', async () => {
      const client = createMockSocket({
        auth: {},
        headers: { authorization: 'Bearer valid-token-from-header' },
      });

      await gateway.handleConnection(client);

      expect(jwtService.verify).toHaveBeenCalledWith('valid-token-from-header');
      expect(client.data.identity).toBeDefined();
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 订阅订单房间测试
  // ──────────────────────────────────────────────────────────────

  describe('subscribe.order', () => {
    function createAuthenticatedClient(): jest.Mocked<Socket> {
      const client = createMockSocket({ auth: { token: 'valid-token' } });
      // 模拟 handleConnection 已鉴权写入 identity
      client.data.identity = {
        userId: 1001,
        email: 'clubuser@example.com',
        phone: '13800138000',
        currentMembership: validMembership,
      };
      return client;
    }

    // ── 4. 用户不能订阅其他用户的订单 ──────────────────────────

    it('4. 用户不能订阅其他用户的订单（findFirst 返回 null 时抛出 UnauthorizedException）', async () => {
      const client = createAuthenticatedClient();
      prismaService.scanOrders.findFirst.mockResolvedValue(null);

      await expect(
        gateway.subscribeOrder(client, { orderId: 9999 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prismaService.scanOrders.findFirst).toHaveBeenCalledWith({
        where: {
          id: 9999,
          clubUserId: 1001,
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    // ── 11a. 授权用户仅加入正确的 order:{orderId} 房间 ────────

    it('11a. 授权用户订阅自己的订单时仅加入 order:{orderId} 房间', async () => {
      const client = createAuthenticatedClient();
      prismaService.scanOrders.findFirst.mockResolvedValue({ id: 5001 });

      const result = await gateway.subscribeOrder(client, {
        orderId: 5001,
      });

      expect(result).toEqual({ room: 'order:5001' });
      expect(client.join).toHaveBeenCalledWith('order:5001');
      expect(client.join).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 订阅会话房间测试
  // ──────────────────────────────────────────────────────────────

  describe('subscribe.session', () => {
    function createAuthenticatedClient(): jest.Mocked<Socket> {
      const client = createMockSocket({ auth: { token: 'valid-token' } });
      client.data.identity = {
        userId: 1001,
        email: 'clubuser@example.com',
        phone: '13800138000',
        currentMembership: validMembership,
      };
      return client;
    }

    // ── 5. 用户不能订阅其他用户的会话 ──────────────────────────

    it('5. 用户不能订阅其他用户的会话（findFirst 返回 null 时抛出 UnauthorizedException）', async () => {
      const client = createAuthenticatedClient();
      prismaService.scanOrderingSession.findFirst.mockResolvedValue(null);

      await expect(
        gateway.subscribeSession(client, { sessionId: 8888 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);

      expect(prismaService.scanOrderingSession.findFirst).toHaveBeenCalledWith({
        where: {
          id: 8888,
          clubUserId: 1001,
          deletedAt: null,
        },
        select: { id: true },
      });
      expect(client.join).not.toHaveBeenCalled();
    });

    // ── 11b. 授权用户仅加入正确的 session:{sessionId} 房间 ────

    it('11b. 授权用户订阅自己的会话时仅加入 session:{sessionId} 房间', async () => {
      const client = createAuthenticatedClient();
      prismaService.scanOrderingSession.findFirst.mockResolvedValue({
        id: 7001,
      });

      const result = await gateway.subscribeSession(client, {
        sessionId: 7001,
      });

      expect(result).toEqual({ room: 'session:7001' });
      expect(client.join).toHaveBeenCalledWith('session:7001');
      expect(client.join).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 订阅门店房间测试
  // ──────────────────────────────────────────────────────────────

  describe('subscribe.store', () => {
    function createAuthenticatedClient(
      membership: AuthenticatedMembership | null = validMembership,
    ): jest.Mocked<Socket> {
      const client = createMockSocket({ auth: { token: 'valid-token' } });
      client.data.identity = {
        userId: 1001,
        email: 'clubuser@example.com',
        phone: '13800138000',
        currentMembership: membership,
      };
      return client;
    }

    // ── 6. 无门店成员上下文的用户不能订阅门店 ──────────────────

    it('6. 无门店成员上下文的用户不能订阅门店（ensureCanAccess 抛 ForbiddenException）', async () => {
      const client = createAuthenticatedClient(null);
      commerceAccessService.ensureCanAccessStoreWithAnyPermission.mockRejectedValue(
        new ForbiddenException('无权订阅该门店'),
      );

      await expect(
        gateway.subscribeStore(client, { storeId: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(client.join).not.toHaveBeenCalled();
    });

    // ── 7. 无扫码点餐权限的门店成员不能订阅门店 ────────────────

    it('7. 无扫码点餐权限的门店成员不能订阅门店', async () => {
      const noScanPermission: AuthenticatedMembership = {
        ...validMembership,
        permissions: ['goods:view'],
      };
      const client = createAuthenticatedClient(noScanPermission);
      commerceAccessService.ensureCanAccessStoreWithAnyPermission.mockRejectedValue(
        new ForbiddenException('无权订阅该门店'),
      );

      await expect(
        gateway.subscribeStore(client, { storeId: 10 }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(client.join).not.toHaveBeenCalled();
    });

    // ── 8. 有 scan-ordering:view 权限的成员可订阅门店 ──────────

    it('8. 有 scan-ordering:view 权限的成员可订阅门店', async () => {
      const viewOnlyMembership: AuthenticatedMembership = {
        ...validMembership,
        permissions: ['scan-ordering:view'],
      };
      const client = createAuthenticatedClient(viewOnlyMembership);
      commerceAccessService.ensureCanAccessStoreWithAnyPermission.mockResolvedValue(
        undefined,
      );

      const result = await gateway.subscribeStore(client, { storeId: 10 });

      expect(result).toEqual({ room: 'store:10', storeId: 10 });
      expect(client.join).toHaveBeenCalledWith('store:10');
      expect(
        commerceAccessService.ensureCanAccessStoreWithAnyPermission,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 1001,
          currentMembership: viewOnlyMembership,
        }),
        10,
        ['scan-ordering:view', 'scan-ordering:order-process'],
        '无权订阅该门店',
      );
    });

    // ── 9. 有 scan-ordering:order-process 权限的成员可订阅门店 ─

    it('9. 有 scan-ordering:order-process 权限的成员可订阅门店', async () => {
      const processOnlyMembership: AuthenticatedMembership = {
        ...validMembership,
        permissions: ['scan-ordering:order-process'],
      };
      const client = createAuthenticatedClient(processOnlyMembership);
      commerceAccessService.ensureCanAccessStoreWithAnyPermission.mockResolvedValue(
        undefined,
      );

      const result = await gateway.subscribeStore(client, { storeId: 10 });

      expect(result).toEqual({ room: 'store:10', storeId: 10 });
      expect(client.join).toHaveBeenCalledWith('store:10');
    });

    // ── 10. 成员不能订阅其他门店 ──────────────────────────────

    it('10. 成员不能订阅其他门店（storeId 不匹配时抛 ForbiddenException）', async () => {
      const client = createAuthenticatedClient(validMembership);
      commerceAccessService.ensureCanAccessStoreWithAnyPermission.mockRejectedValue(
        new ForbiddenException('无权订阅该门店'),
      );

      await expect(
        gateway.subscribeStore(client, { storeId: 99 }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(client.join).not.toHaveBeenCalled();
    });

    // ── 11c. 授权用户仅加入正确的 store:{storeId} 房间 ────────

    it('11c. 授权用户订阅门店时仅加入 store:{storeId} 房间', async () => {
      const client = createAuthenticatedClient(validMembership);

      const result = await gateway.subscribeStore(client, { storeId: 10 });

      expect(result).toEqual({ room: 'store:10', storeId: 10 });
      expect(client.join).toHaveBeenCalledWith('store:10');
      expect(client.join).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────────────────────────
  // 未认证连接访问订阅消息测试
  // ──────────────────────────────────────────────────────────────

  describe('未认证连接访问订阅消息', () => {
    it('未认证连接调用 subscribe.order 时抛出 UnauthorizedException', async () => {
      const client = createMockSocket({ auth: {} });
      // handleConnection 鉴权失败，data.identity 未写入

      await expect(
        gateway.subscribeOrder(client, { orderId: 1 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('未认证连接调用 subscribe.session 时抛出 UnauthorizedException', async () => {
      const client = createMockSocket({ auth: {} });

      await expect(
        gateway.subscribeSession(client, { sessionId: 1 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });

    it('未认证连接调用 subscribe.store 时抛出 UnauthorizedException', async () => {
      const client = createMockSocket({ auth: {} });

      await expect(
        gateway.subscribeStore(client, { storeId: 1 }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
    });
  });
});
