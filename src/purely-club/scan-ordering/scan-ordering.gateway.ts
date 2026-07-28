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
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  UnauthorizedException,
} from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { Namespace, Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
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

// 实时链路防误改：管理端必须连接该 namespace；事件广播也必须从同一 namespace 发出，
// 不能改为顶层 Server 的默认 / namespace，否则客户端订阅房间将收不到订单事件。
@WebSocketGateway({
  namespace: SCAN_ORDERING_NAMESPACE,
  path: '/socket.io',
  transports: ['websocket', 'polling'],
  allowUpgrades: true,
  cors: { origin: true, credentials: true },
})
export class ScanOrderingGateway
  implements OnGatewayConnection, OnApplicationBootstrap, OnApplicationShutdown
{
  @WebSocketServer()
  server: Namespace;

  private readonly logger = new Logger(ScanOrderingGateway.name);
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;

  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly authMembershipResolverService: AuthMembershipResolverService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  afterInit(server: Namespace): void {
    this.realtimeService.bindNamespace(server);
    server.use((client, next) => {
      void this.authenticateBeforeConnection(client, next);
    });
  }

  async onApplicationBootstrap(): Promise<void> {
    if (!this.server) {
      throw new Error('Socket.IO server 尚未初始化');
    }
    const { publisher, subscriber } = this.redisService.createPubSubClients();
    this.redisPublisher = publisher;
    this.redisSubscriber = subscriber;
    try {
      await Promise.all([
        this.waitForRedisReady(publisher),
        this.waitForRedisReady(subscriber),
      ]);
      // 多 Worker / 多实例必须在顶层 Socket.IO Server 挂载官方 Redis Adapter；
      // Namespace 没有 adapter()，不能改为 this.server.adapter(...).
      this.server.server.adapter(createAdapter(publisher, subscriber));
      this.realtimeService.markSocketIoAdapterReady();
      this.logger.log(
        `Socket.IO Redis adapter initialized on namespace=${SCAN_ORDERING_NAMESPACE}`,
      );
    } catch (error) {
      await Promise.allSettled([publisher.quit(), subscriber.quit()]);
      this.redisPublisher = null;
      this.redisSubscriber = null;
      throw error;
    }
  }

  private async waitForRedisReady(client: Redis): Promise<void> {
    if (client.status === 'ready') return;
    await new Promise<void>((resolve, reject) => {
      const handleReady = (): void => cleanup(resolve);
      const handleError = (error: Error): void => cleanup(() => reject(error));
      const cleanup = (complete: () => void): void => {
        client.off('ready', handleReady);
        client.off('error', handleError);
        complete();
      };
      client.once('ready', handleReady);
      client.once('error', handleError);
    });
  }

  async onApplicationShutdown(_signal?: string): Promise<void> {
    this.logger.log(
      `Shutting down Socket.IO Redis adapter for namespace=${SCAN_ORDERING_NAMESPACE}`,
    );

    // 先断开所有客户端连接，停止接收新消息
    if (this.server) {
      this.server.sockets.forEach((socket) => {
        socket.leave('*'); // 退出所有房间
      });
      this.server.timeout(5000).emit('server_shutting_down');
    }

    // 退出频道订阅
    await Promise.allSettled([
      this.redisPublisher?.punsubscribe('*') ?? Promise.resolve('OK'),
      this.redisSubscriber?.punsubscribe('*') ?? Promise.resolve('OK'),
    ]);

    // 最后才关闭 Redis 连接
    await Promise.allSettled([
      this.redisPublisher?.quit() ?? Promise.resolve('OK'),
      this.redisSubscriber?.quit() ?? Promise.resolve('OK'),
    ]);

    this.redisPublisher = null;
    this.redisSubscriber = null;
    this.logger.log(`Socket.IO Redis adapter shutdown complete`);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const storedIdentity = client.data.identity as SocketIdentity | undefined;
      const identity = storedIdentity ?? (await this.authenticate(client));
      client.data.identity = identity;
      const transport = client.conn?.transport.name ?? 'unknown';
      this.logger.log(
        `socket connected: id=${client.id}, userId=${identity.userId}, transport=${transport}`,
      );
    } catch (error) {
      this.logger.warn(
        `拒绝未鉴权扫码点餐 Socket 连接: ${client.id}, error=${error instanceof Error ? error.message : String(error)}`,
      );
      client.emit('connection_error', { message: '认证失败，请重新登录' });
      client.disconnect(true);
    }
  }

  private async authenticateBeforeConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      client.data.identity = await this.authenticate(client);
      next();
    } catch (error) {
      this.logger.warn(
        `拒绝未鉴权扫码点餐 Socket 连接: ${client.id}, error=${error instanceof Error ? error.message : String(error)}`,
      );
      next(new Error('认证失败，请重新登录'));
    }
  }

  @SubscribeMessage('subscribe.order')
  async subscribeOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinOrderPayload,
  ): Promise<{ room: string }> {
    const identity = this.identityOf(client);
    this.logger.log(
      `subscribe.order requested: socketId=${client.id}, userId=${identity.userId}, orderId=${payload.orderId}`,
    );
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
    this.logger.log(
      `subscribe.order joined: socketId=${client.id}, room=${room}`,
    );
    return { room };
  }

  @SubscribeMessage('subscribe.session')
  async subscribeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionPayload,
  ): Promise<{ room: string }> {
    const identity = this.identityOf(client);
    this.logger.log(
      `subscribe.session requested: socketId=${client.id}, userId=${identity.userId}, sessionId=${payload.sessionId}`,
    );
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
    this.logger.log(
      `subscribe.session joined: socketId=${client.id}, room=${room}`,
    );
    return { room };
  }

  @SubscribeMessage('subscribe.store')
  async subscribeStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<{ room: string; storeId: number }> {
    const identity = this.identityOf(client);
    this.logger.log(
      `subscribe.store requested: socketId=${client.id}, userId=${identity.userId}, storeId=${payload.storeId}`,
    );
    try {
      await this.commerceAccessService.ensureCanAccessStoreWithAnyPermission(
        this.toAuthenticatedUser(identity),
        payload.storeId,
        ['scan-ordering:view', 'scan-ordering:order-process'],
        '无权订阅该门店',
      );
      const room = this.realtimeService.storeRoom(payload.storeId);
      await client.join(room);
      this.logger.log(
        `subscribe.store joined: socketId=${client.id}, room=${room}`,
      );
      return { room, storeId: payload.storeId };
    } catch (error) {
      this.logger.error(
        `subscribe.store failed: socketId=${client.id}, userId=${identity.userId}, storeId=${payload.storeId}, membership=${JSON.stringify(identity.currentMembership)}, error=${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw error;
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
