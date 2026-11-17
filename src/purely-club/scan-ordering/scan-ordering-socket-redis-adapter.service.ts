import { Injectable, Logger } from '@nestjs/common';
import { createAdapter } from '@socket.io/redis-adapter';
import type Redis from 'ioredis';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';
import {
  SCAN_ORDERING_NAMESPACE,
  ScanOrderingRealtimeService,
} from './scan-ordering-realtime.service';

/**
 * 扫码点餐 Socket.IO Redis adapter 生命周期。
 *
 * 多 Worker / 多实例必须在**顶层** Socket.IO Server 挂载官方 Redis Adapter；
 * Namespace 没有 `adapter()`，不能改为 `namespace.adapter(...)`。
 */
@Injectable()
export class ScanOrderingSocketRedisAdapterService {
  private readonly logger = new Logger(
    ScanOrderingSocketRedisAdapterService.name,
  );
  private redisPublisher: Redis | null = null;
  private redisSubscriber: Redis | null = null;

  constructor(
    private readonly redisService: RedisService,
    private readonly realtimeService: ScanOrderingRealtimeService,
  ) {}

  /** 建立 Pub/Sub 连接并挂载 adapter，就绪后放行实时广播。 */
  async connect(server: Namespace): Promise<void> {
    const { publisher, subscriber } = this.redisService.createPubSubClients();
    this.redisPublisher = publisher;
    this.redisSubscriber = subscriber;
    try {
      await Promise.all([
        this.waitForRedisReady(publisher),
        this.waitForRedisReady(subscriber),
      ]);
      server.server.adapter(createAdapter(publisher, subscriber));
      this.realtimeService.markSocketIoAdapterReady();
      this.logger.debug(
        `Socket.IO Redis adapter initialized on namespace=${SCAN_ORDERING_NAMESPACE}`,
      );
    } catch (error) {
      await Promise.allSettled([publisher.quit(), subscriber.quit()]);
      this.redisPublisher = null;
      this.redisSubscriber = null;
      throw error;
    }
  }

  /** 关闭是一次性事件，保留 log 便于运维确认下线过程。 */
  async disconnect(server?: Namespace): Promise<void> {
    this.logger.log(
      `Shutting down Socket.IO Redis adapter for namespace=${SCAN_ORDERING_NAMESPACE}`,
    );

    // 先断开所有客户端连接，停止接收新消息
    if (server) {
      server.sockets.forEach((socket) => {
        void socket.leave('*'); // 退出所有房间
      });
      server.emit('server_shutting_down');
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
}
