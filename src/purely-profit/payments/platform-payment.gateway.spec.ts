// 平台收款网关回归：支付单订阅的归属校验。
//
// 这里守的是「支付结果不能串到别人手机上」这条边界：
// - 平台支付单（PM / PQ）有 operatorUserId，按发起人校验；
// - 短信充值单（SM）没有操作人字段，只能按门店校验；
// - 两张表都不存在才是「支付单不存在」，不能因为短信单在另一张表就误拒；
// - membership 必须**懒解析**：平台单用不到门店上下文，不该付这次查询（含 legacy owner 修复写库）。
import { Test, TestingModule } from '@nestjs/testing';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ForbiddenException,
  UnauthorizedException,
} from '@nestjs/common';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessControlService } from '../access-control/access-control.service';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { AuthMembershipResolverService } from '../auth/auth-membership-resolver.service';
import type { AuthenticatedMembership } from '../access-control/access-control.service';
import type { JwtPayload } from '../auth/strategies/jwt.strategy';
import { PlatformPaymentGateway } from './platform-payment.gateway';
import { PlatformPaymentRealtimeService } from './platform-payment-realtime.service';

const USER_ID = 1001;
const OTHER_USER_ID = 2002;
const OWN_STORE_ID = 18;
const OTHER_STORE_ID = 19;
const SMS_ORDER_NO = 'SM202610271200001234AB';
const PLATFORM_ORDER_NO = 'PQ202610271200001234AB';

interface GatewayIdentity {
  userId: number;
  email: string;
  phone: string;
  tokenPayload: JwtPayload;
}

/** 构造一个最小可用的 Socket mock，identity 由用例直接注入（模拟鉴权后写入） */
const createMockSocket = (
  identity: GatewayIdentity | null,
): jest.Mocked<Socket> => {
  const client = {
    id: 'mock-socket-id',
    data: {},
    handshake: { auth: {}, headers: {} },
    emit: jest.fn(),
    disconnect: jest.fn(),
    join: jest.fn(),
    leave: jest.fn(),
  } as unknown as jest.Mocked<Socket>;

  if (identity) {
    client.data.identity = identity;
  }

  return client;
};

/** 门店成员上下文：permissions 决定能否通过 marketing:view 这道门 */
const buildMembership = (
  storeId: number,
  permissions: string[],
): AuthenticatedMembership => ({
  staffId: 50,
  storeId,
  role: 'owner',
  permissions,
  isActive: true,
  subjectType: 'owner',
  linkedEmployeeId: null,
  subAccountId: null,
  subAccountRole: null,
  subAccountStatus: null,
  subAccountAssigned: false,
  canAccessHome: true,
  canUseHandover: true,
});

const buildIdentity = (userId = USER_ID): GatewayIdentity => ({
  userId,
  email: 'owner@example.com',
  phone: '13800138000',
  tokenPayload: { sub: userId, phone: '13800138000' },
});

describe('PlatformPaymentGateway', () => {
  let gateway: PlatformPaymentGateway;

  const prismaService = {
    user: { findUnique: jest.fn() },
    platformPaymentOrder: { findUnique: jest.fn() },
    smsRechargeOrder: { findUnique: jest.fn() },
  };

  let accessControlService: { resolveCurrentStoreIdByPermission: jest.Mock };
  const membershipResolverService = {
    resolveAuthenticatedMembership: jest.fn(),
  };
  const realtimeService = {
    bindNamespace: jest.fn(),
    orderRoom: jest.fn((orderNo: string) => `profit:payment:${orderNo}`),
    publishPaid: jest.fn(),
    publishFailed: jest.fn(),
    publishClosed: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    prismaService.platformPaymentOrder.findUnique.mockResolvedValue(null);
    prismaService.smsRechargeOrder.findUnique.mockResolvedValue(null);
    // 默认：当前用户的「当前门店」是 OWN_STORE_ID
    accessControlService = {
      resolveCurrentStoreIdByPermission: jest.fn(() => OWN_STORE_ID),
    };
    membershipResolverService.resolveAuthenticatedMembership.mockResolvedValue(
      buildMembership(OWN_STORE_ID, ['marketing:view']),
    );

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PlatformPaymentGateway,
        { provide: JwtService, useValue: { verify: jest.fn() } },
        { provide: PrismaService, useValue: prismaService },
        { provide: AccessControlService, useValue: accessControlService },
        // 用真实的权限闸门：本文件要验的正是「当前门店语义」会不会误拒
        CommerceAccessService,
        {
          provide: AuthMembershipResolverService,
          useValue: membershipResolverService,
        },
        { provide: PlatformPaymentRealtimeService, useValue: realtimeService },
      ],
    }).compile();

    gateway = module.get<PlatformPaymentGateway>(PlatformPaymentGateway);
  });

  describe('subscribe.payment-order 平台支付单', () => {
    it('本人订阅自己的平台支付单时成功入房', async () => {
      prismaService.platformPaymentOrder.findUnique.mockResolvedValue({
        operatorUserId: USER_ID,
      });
      const client = createMockSocket(buildIdentity());

      const result = await gateway.subscribePaymentOrder(client, {
        orderNo: PLATFORM_ORDER_NO,
      });

      expect(result).toEqual({
        room: `profit:payment:${PLATFORM_ORDER_NO}`,
        orderNo: PLATFORM_ORDER_NO,
      });
      expect(client.join).toHaveBeenCalledWith(
        `profit:payment:${PLATFORM_ORDER_NO}`,
      );
    });

    it('本人订阅平台支付单时不解析 membership（懒解析：平台单用不到门店上下文）', async () => {
      prismaService.platformPaymentOrder.findUnique.mockResolvedValue({
        operatorUserId: USER_ID,
      });

      await gateway.subscribePaymentOrder(createMockSocket(buildIdentity()), {
        orderNo: PLATFORM_ORDER_NO,
      });

      expect(
        membershipResolverService.resolveAuthenticatedMembership,
      ).not.toHaveBeenCalled();
    });

    it('他人订阅该平台支付单时被拒（UnauthorizedException）', async () => {
      prismaService.platformPaymentOrder.findUnique.mockResolvedValue({
        operatorUserId: OTHER_USER_ID,
      });
      const client = createMockSocket(buildIdentity());

      await expect(
        gateway.subscribePaymentOrder(client, { orderNo: PLATFORM_ORDER_NO }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('空单号直接拒绝，不查库', async () => {
      const client = createMockSocket(buildIdentity());

      await expect(
        gateway.subscribePaymentOrder(client, { orderNo: '   ' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        prismaService.platformPaymentOrder.findUnique,
      ).not.toHaveBeenCalled();
      expect(prismaService.smsRechargeOrder.findUnique).not.toHaveBeenCalled();
    });
  });

  describe('subscribe.payment-order 短信充值单', () => {
    it('本门店用户订阅本门店短信单时成功入房（SM 前缀不再被误判为不存在）', async () => {
      prismaService.smsRechargeOrder.findUnique.mockResolvedValue({
        storeId: OWN_STORE_ID,
      });
      const client = createMockSocket(buildIdentity());

      const result = await gateway.subscribePaymentOrder(client, {
        orderNo: SMS_ORDER_NO,
      });

      expect(result).toEqual({
        room: `profit:payment:${SMS_ORDER_NO}`,
        orderNo: SMS_ORDER_NO,
      });
      expect(client.join).toHaveBeenCalledWith(
        `profit:payment:${SMS_ORDER_NO}`,
      );
      // 权限码与短信查单接口同口径
      expect(
        accessControlService.resolveCurrentStoreIdByPermission,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ id: USER_ID }),
        'marketing:view',
      );
    });

    it('短信单归属校验时才解析 membership（懒解析命中路径）', async () => {
      prismaService.smsRechargeOrder.findUnique.mockResolvedValue({
        storeId: OWN_STORE_ID,
      });

      await gateway.subscribePaymentOrder(createMockSocket(buildIdentity()), {
        orderNo: SMS_ORDER_NO,
      });

      expect(
        membershipResolverService.resolveAuthenticatedMembership,
      ).toHaveBeenCalledTimes(1);
    });

    it('主账号 / legacy owner（无子账号席位）订阅本门店短信单同样能入房', async () => {
      prismaService.smsRechargeOrder.findUnique.mockResolvedValue({
        storeId: OWN_STORE_ID,
      });
      // 关键守护：底层 resolveCurrentStoreIdByPermission 只认「当前门店」，
      // 若它返回 null（历史数据未修复）会导致全量误拒，这里确保主账号不受影响
      accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(
        OWN_STORE_ID,
      );
      // legacy owner：没有子账号席位，权限集为空，靠 owner 角色默认权限放行
      membershipResolverService.resolveAuthenticatedMembership.mockResolvedValue(
        buildMembership(OWN_STORE_ID, []),
      );
      const client = createMockSocket(buildIdentity());

      const result = await gateway.subscribePaymentOrder(client, {
        orderNo: SMS_ORDER_NO,
      });

      expect(result.orderNo).toBe(SMS_ORDER_NO);
      expect(client.join).toHaveBeenCalledTimes(1);
    });

    it('非本门店用户订阅短信单被拒，且冒泡的是 ForbiddenException', async () => {
      prismaService.smsRechargeOrder.findUnique.mockResolvedValue({
        storeId: OTHER_STORE_ID,
      });
      const client = createMockSocket(buildIdentity());

      await expect(
        gateway.subscribePaymentOrder(client, { orderNo: SMS_ORDER_NO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('当前门店解析为 null（无门店上下文）时订阅短信单被拒', async () => {
      prismaService.smsRechargeOrder.findUnique.mockResolvedValue({
        storeId: OWN_STORE_ID,
      });
      accessControlService.resolveCurrentStoreIdByPermission.mockReturnValue(
        null,
      );
      const client = createMockSocket(buildIdentity());

      await expect(
        gateway.subscribePaymentOrder(client, { orderNo: SMS_ORDER_NO }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(client.join).not.toHaveBeenCalled();
    });

    it('两张表都不存在时才抛「支付单不存在」', async () => {
      const client = createMockSocket(buildIdentity());

      await expect(
        gateway.subscribePaymentOrder(client, { orderNo: 'PM9999999999999' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(
        prismaService.platformPaymentOrder.findUnique,
      ).toHaveBeenCalledTimes(1);
      expect(prismaService.smsRechargeOrder.findUnique).toHaveBeenCalledTimes(
        1,
      );
    });
  });

  describe('未认证连接', () => {
    it('未写入 identity 的连接调用订阅时抛出 UnauthorizedException', async () => {
      const client = createMockSocket(null);

      await expect(
        gateway.subscribePaymentOrder(client, { orderNo: SMS_ORDER_NO }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(client.join).not.toHaveBeenCalled();
    });
  });
});
