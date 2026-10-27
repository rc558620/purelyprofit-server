// 平台收款 Socket.IO 网关：商家端页面按支付单号订阅支付结果，替代下单后的轮询。
//
// 权限口径：连接必须带有效 JWT；入房前按支付单归属校验，杜绝订阅他人支付单
// （支付单号是半公开信息，只认单号即可串到别人的支付结果）。
//
// 归属判定分两种，因为「商家付钱给平台」的支付单分散在两张表：
// 1. `platform_payment_orders`（会员套餐 PM / 新客额度 PQ 等）：有 operatorUserId，
//    按「发起人 === 当前用户」校验；
// 2. `sms_recharge_orders`（短信钱包充值 SM）：**没有操作人字段**，只有 storeId，
//    只能退一步按门店校验（权限码与短信查单接口同为 marketing:view）。
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../commerce/commerce-access.service';
import { AuthMembershipResolverService } from '../auth/auth-membership-resolver.service';
import type { AuthenticatedMembership } from '../access-control/access-control.service';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../auth/strategies/jwt.strategy';
import {
  PROFIT_PAYMENT_NAMESPACE,
  PlatformPaymentRealtimeService,
} from './platform-payment-realtime.service';

/** 短信充值单按门店校验时使用的权限码，与短信查单接口同口径 */
const SMS_ORDER_ACCESS_PERMISSION = 'marketing:view';

interface SocketIdentity {
  userId: number;
  email: string;
  phone: string;
  /**
   * 原始 JWT 载荷，供**懒解析**会员上下文使用。
   *
   * 刻意不在握手里就把 membership 解析好：平台支付单走 operatorUserId，
   * 根本用不到门店上下文，而解析查不到行时会触发 legacy owner 修复（写库），
   * 放在握手期会让每次建连都背上这次写操作。
   */
  tokenPayload: JwtPayload;
}

interface SubscribePaymentOrderPayload {
  orderNo: string;
}

interface SubscribePaymentOrderResult {
  room: string;
  orderNo: string;
}

@WebSocketGateway({
  namespace: PROFIT_PAYMENT_NAMESPACE,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  cors: { origin: true, credentials: true },
})
export class PlatformPaymentGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(PlatformPaymentGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly realtimeService: PlatformPaymentRealtimeService,
  ) {}

  afterInit(server: Namespace): void {
    this.realtimeService.bindNamespace(server);
    server.use((client, next) => {
      void this.authenticateBeforeConnection(client, next);
    });
  }

  handleConnection(client: Socket): void {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity) {
      client.disconnect(true);
      return;
    }
    this.logger.log(
      `profit-payment socket connected: id=${client.id}, userId=${identity.userId}`,
    );
  }

  /** 订阅单个支付单的结果：与支付单查询接口同归属口径 */
  @SubscribeMessage('subscribe.payment-order')
  async subscribePaymentOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: SubscribePaymentOrderPayload,
  ): Promise<SubscribePaymentOrderResult> {
    const identity = this.identityOf(client);
    const orderNo =
      typeof payload?.orderNo === 'string' ? payload.orderNo.trim() : '';
    if (!orderNo) {
      throw new BadRequestException('支付单号无效');
    }

    await this.ensureCanSubscribeOrder(identity, orderNo);

    const room = this.realtimeService.orderRoom(orderNo);
    await client.join(room);
    this.logger.log(
      `subscribe.payment-order joined: socketId=${client.id}, userId=${identity.userId}, room=${room}`,
    );
    return { room, orderNo };
  }

  /**
   * 支付单订阅的归属校验：两张表两种口径。
   *
   * 短信充值单落在独立的 `sms_recharge_orders`（前缀 SM），表里没有 operatorUserId，
   * 无法按发起人校验，只能按门店判定——权限码与短信查单接口保持同口径。
   */
  private async ensureCanSubscribeOrder(
    identity: SocketIdentity,
    orderNo: string,
  ): Promise<void> {
    const platformOrder = await this.prisma.platformPaymentOrder.findUnique({
      where: { orderNo },
      select: { operatorUserId: true },
    });

    if (platformOrder) {
      if (platformOrder.operatorUserId !== identity.userId) {
        throw new UnauthorizedException('无权订阅该支付单');
      }
      return;
    }

    const smsOrder = await this.prisma.smsRechargeOrder.findUnique({
      where: { orderNo },
      select: { storeId: true },
    });

    if (!smsOrder) {
      throw new BadRequestException('支付单不存在');
    }

    await this.ensureCanSubscribeSmsOrder(identity, smsOrder.storeId);
  }

  /**
   * 短信充值单按门店校验归属。
   *
   * membership 在这里**懒解析**：只有真正走到短信单才需要门店上下文，
   * 平台支付单那条路径不会付出这次查询（以及可能的 legacy owner 修复写库）的代价。
   */
  private async ensureCanSubscribeSmsOrder(
    identity: SocketIdentity,
    storeId: number,
  ): Promise<void> {
    const currentMembership =
      await this.authMembershipResolverService.resolveAuthenticatedMembership(
        identity.tokenPayload,
        identity.email,
      );

    // 无权时 CommerceAccessService 内部抛 ForbiddenException，让它自然冒泡即可
    await this.commerceAccessService.ensureCanAccessStore(
      this.toAuthenticatedUser(identity, currentMembership),
      storeId,
      SMS_ORDER_ACCESS_PERMISSION,
      '无权订阅该支付单',
    );
  }

  private toAuthenticatedUser(
    identity: SocketIdentity,
    currentMembership: AuthenticatedMembership | null,
  ): AuthenticatedUser {
    return {
      id: identity.userId,
      email: identity.email,
      phone: identity.phone,
      name: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastActiveAt: null,
      currentMembership,
    };
  }

  private async authenticateBeforeConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      client.data.identity = await this.authenticate(client);
      next();
    } catch {
      this.logger.warn(`拒绝未鉴权平台收款 Socket 连接: ${client.id}`);
      next(new Error('认证失败，请重新登录'));
    }
  }

  private async authenticate(client: Socket): Promise<SocketIdentity> {
    const rawToken =
      client.handshake.auth?.token ??
      client.handshake.headers.authorization?.replace(/^Bearer\s+/i, '');
    if (typeof rawToken !== 'string' || !rawToken) {
      throw new UnauthorizedException('缺少访问令牌');
    }
    const payload = this.jwtService.verify<JwtPayload>(rawToken);
    if (!payload.sub) throw new UnauthorizedException('访问令牌无效');
    const account = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { email: true },
    });
    if (!account) throw new UnauthorizedException('用户不存在');
    return {
      userId: payload.sub,
      email: account.email,
      phone: payload.phone ?? '',
      tokenPayload: payload,
    };
  }

  private identityOf(client: Socket): SocketIdentity {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity) throw new UnauthorizedException('连接尚未认证');
    return identity;
  }
}
