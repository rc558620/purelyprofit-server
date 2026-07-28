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
import type { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { CommerceAccessService } from '../../purely-profit/commerce/commerce-access.service';
import { AuthMembershipResolverService } from '../../purely-profit/auth/auth-membership-resolver.service';
import type { AuthenticatedMembership } from '../../purely-profit/access-control/access-control.service';
import type {
  AuthenticatedUser,
  JwtPayload,
} from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  SERVICE_CALL_NAMESPACE,
  ServiceCallRealtimeService,
} from './service-call-realtime.service';

interface SocketIdentity {
  userId: number;
  email: string;
  phone: string;
  currentMembership: AuthenticatedMembership | null;
}

interface JoinStorePayload {
  storeId: number;
}

@WebSocketGateway({
  namespace: SERVICE_CALL_NAMESPACE,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  cors: { origin: true, credentials: true },
})
export class ServiceCallGateway implements OnGatewayConnection {
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(ServiceCallGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly realtimeService: ServiceCallRealtimeService,
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
    const room = this.realtimeService.clubUserRoom(identity.userId);
    void client.join(room);
    this.logger.log(
      `service-call socket connected: id=${client.id}, userId=${identity.userId}, room=${room}`,
    );
    client.on('disconnect', (reason) => {
      this.logger.log(
        `service-call socket disconnected: id=${client.id}, userId=${identity.userId}, reason=${reason}`,
      );
    });
  }

  @SubscribeMessage('subscribe.store')
  async subscribeStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<{ room: string; storeId: number }> {
    const identity = this.identityOf(client);
    await this.commerceAccessService.ensureCanAccessStoreWithAnyPermission(
      this.toAuthenticatedUser(identity),
      payload.storeId,
      ['service-call:view', 'service-call:process'],
      '无权订阅该门店服务呼叫',
    );
    const room = this.realtimeService.storeRoom(payload.storeId);
    await client.join(room);
    return { room, storeId: payload.storeId };
  }

  private async authenticateBeforeConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      client.data.identity = await this.authenticate(client);
      next();
    } catch (_error) {
      this.logger.warn(`拒绝未鉴权服务呼叫 Socket 连接: ${client.id}`);
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
      phone: payload.phone,
      currentMembership:
        await this.authMembershipResolverService.resolveAuthenticatedMembership(
          payload,
          account.email,
        ),
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
