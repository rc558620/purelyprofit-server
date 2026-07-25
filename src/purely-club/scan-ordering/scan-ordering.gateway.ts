import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Logger, UnauthorizedException } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import { AuthMembershipResolverService } from '../../purely-profit/auth/auth-membership-resolver.service';
import type { AuthenticatedMembership } from '../../purely-profit/access-control/access-control.service';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  SCAN_ORDERING_NAMESPACE,
  ScanOrderingRealtimeService,
} from './scan-ordering-realtime.service';

interface SocketIdentity {
  userId: number;
  email: string;
  phone: string;
  currentMembership: AuthenticatedMembership | null;
}

interface JoinOrderPayload {
  orderId: number;
}

interface JoinSessionPayload {
  sessionId: number;
}

interface JoinStorePayload {
  storeId: number;
}

@WebSocketGateway({
  namespace: SCAN_ORDERING_NAMESPACE,
  cors: { origin: true, credentials: true },
})
export class ScanOrderingGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Server;

  private readonly logger = new Logger(ScanOrderingGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  afterInit(server: Server): void {
    this.realtimeService.bindServer(server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      client.data.identity = await this.authenticate(client);
    } catch {
      this.logger.warn(`拒绝未鉴权扫码点餐 Socket 连接: ${client.id}`);
      client.emit('connection_error', { message: '认证失败，请重新登录' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('subscribe.order')
  async subscribeOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinOrderPayload,
  ): Promise<{ room: string }> {
    const identity = this.identityOf(client);
    const order = await this.prisma.scanOrders.findFirst({
      where: {
        id: payload.orderId,
        clubUserId: identity.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!order) throw new UnauthorizedException('无权订阅该订单');
    const room = this.realtimeService.orderRoom(order.id);
    await client.join(room);
    return { room };
  }

  @SubscribeMessage('subscribe.session')
  async subscribeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionPayload,
  ): Promise<{ room: string }> {
    const identity = this.identityOf(client);
    const session = await this.prisma.scanOrderingSession.findFirst({
      where: {
        id: payload.sessionId,
        clubUserId: identity.userId,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (!session) throw new UnauthorizedException('无权订阅该点餐会话');
    const room = this.realtimeService.sessionRoom(session.id);
    await client.join(room);
    return { room };
  }

  @SubscribeMessage('subscribe.store')
  async subscribeStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<{ room: string }> {
    const identity = this.identityOf(client);
    await this.commerceAccessService.ensureCanAccessStoreWithAnyPermission(
      this.toAuthenticatedUser(identity),
      payload.storeId,
      ['scan-ordering:view', 'scan-ordering:order-process'],
      '无权订阅该门店',
    );
    const room = this.realtimeService.storeRoom(payload.storeId);
    await client.join(room);
    return { room };
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
    const currentMembership =
      await this.authMembershipResolverService.resolveAuthenticatedMembership(
        payload,
        account.email,
      );
    return {
      userId: payload.sub,
      email: account.email,
      phone: payload.phone,
      currentMembership,
    };
  }

  private toAuthenticatedUser(identity: SocketIdentity): AuthenticatedUser {
    return {
      id: identity.userId,
      email: identity.email,
      phone: identity.phone,
      name: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
      lastActiveAt: null,
      currentMembership: identity.currentMembership,
    };
  }

  private identityOf(client: Socket): SocketIdentity {
    const identity = client.data.identity as SocketIdentity | undefined;
    if (!identity) throw new UnauthorizedException('连接尚未认证');
    return identity;
  }
}
