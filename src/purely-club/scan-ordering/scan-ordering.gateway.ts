import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import {
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { Namespace, Socket } from 'socket.io';
import {
  SCAN_ORDERING_NAMESPACE,
  ScanOrderingRealtimeService,
} from './scan-ordering-realtime.service';
import { ScanOrderingSocketAuthService } from './scan-ordering-socket-auth.service';
import { ScanOrderingSocketRedisAdapterService } from './scan-ordering-socket-redis-adapter.service';
import { ScanOrderingSubscriptionService } from './scan-ordering-subscription.service';
import type {
  JoinOrderPayload,
  JoinRoomResult,
  JoinSessionPayload,
  JoinStorePayload,
  JoinStoreRoomResult,
  JoinVoucherOrderPayload,
  SocketIdentity,
} from './scan-ordering-socket.types';

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

  constructor(
    private readonly socketAuthService: ScanOrderingSocketAuthService,
    private readonly realtimeService: ScanOrderingRealtimeService,
    private readonly redisAdapterService: ScanOrderingSocketRedisAdapterService,
    private readonly subscriptionService: ScanOrderingSubscriptionService,
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
    await this.redisAdapterService.connect(this.server);
  }

  async onApplicationShutdown(_signal?: string): Promise<void> {
    await this.redisAdapterService.disconnect(this.server);
  }

  async handleConnection(client: Socket): Promise<void> {
    try {
      const storedIdentity = client.data.identity as SocketIdentity | undefined;
      const identity =
        storedIdentity ?? (await this.socketAuthService.authenticate(client));
      client.data.identity = identity;
      const transport = client.conn?.transport.name ?? 'unknown';
      this.logger.debug(
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

  @SubscribeMessage('subscribe.order')
  subscribeOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinOrderPayload,
  ): Promise<JoinRoomResult> {
    return this.subscriptionService.subscribeOrder(client, payload);
  }

  @SubscribeMessage('subscribe.session')
  subscribeSession(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinSessionPayload,
  ): Promise<JoinRoomResult> {
    return this.subscriptionService.subscribeSession(client, payload);
  }

  @SubscribeMessage('subscribe.voucher-order')
  subscribeVoucherOrder(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinVoucherOrderPayload,
  ): Promise<JoinRoomResult> {
    return this.subscriptionService.subscribeVoucherOrder(client, payload);
  }

  @SubscribeMessage('subscribe.voucher-store')
  subscribeVoucherStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    return this.subscriptionService.subscribeVoucherStore(client, payload);
  }

  @SubscribeMessage('subscribe.store')
  subscribeStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    return this.subscriptionService.subscribeStore(client, payload);
  }

  /** 自助下单门店房间订阅（purelyProfit 商家端新订单弹窗），权限与扫码点餐分开 */
  @SubscribeMessage('subscribe.self-ordering-store')
  subscribeSelfOrderingStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    return this.subscriptionService.subscribeSelfOrderingStore(client, payload);
  }

  /** 空间管理门店房间订阅（结账完成实时刷新房态），权限与扫码点餐分开 */
  @SubscribeMessage('subscribe.space-store')
  subscribeSpaceStore(
    @ConnectedSocket() client: Socket,
    @MessageBody() payload: JoinStorePayload,
  ): Promise<JoinStoreRoomResult> {
    return this.subscriptionService.subscribeSpaceStore(client, payload);
  }

  private async authenticateBeforeConnection(
    client: Socket,
    next: (error?: Error) => void,
  ): Promise<void> {
    try {
      client.data.identity = await this.socketAuthService.authenticate(client);
      next();
    } catch (error) {
      this.logger.warn(
        `拒绝未鉴权扫码点餐 Socket 连接: ${client.id}, error=${error instanceof Error ? error.message : String(error)}`,
      );
      next(new Error('认证失败，请重新登录'));
    }
  }
}
