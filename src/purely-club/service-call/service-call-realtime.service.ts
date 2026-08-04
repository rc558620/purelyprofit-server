import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import {
  ServiceCallSource,
  ServiceCallStatus,
  ServiceCallType,
} from '@prisma/client';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';

export const SERVICE_CALL_NAMESPACE = '/service-calls';
const REALTIME_CHANNEL = 'purelyprofit:service-calls:realtime:v1';

type ServiceCallRealtimeEvent = 'service_call.created' | 'service_call.updated';

export interface ServiceCallRealtimePayload {
  /** 服务呼叫唯一标识。 */
  id: number;
  /** 门店唯一标识。 */
  storeId: number;
  /** 呼叫发起来源。 */
  source: ServiceCallSource;
  /** 服务呼叫类型。 */
  type: ServiceCallType;
  /** 当前处理状态。 */
  status: ServiceCallStatus;
  /** 餐饮桌台等位置展示信息。 */
  locationLabel: string | null;
  /** 顾客补充说明。 */
  remark: string | null;
  /** 可选关联扫码订单。 */
  relatedOrderId: number | null;
  /** 服务呼叫创建时间。 */
  createdAt: string;
  /** 对同一工单的累计呼叫次数。 */
  reminderCount?: number;
  /** 发起服务呼叫的 Club 用户 ID，仅用于向该用户回传状态。 */
  clubUserId?: number;
}

interface RealtimeMessage {
  event: ServiceCallRealtimeEvent;
  payload: ServiceCallRealtimePayload;
}

@Injectable()
export class ServiceCallRealtimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ServiceCallRealtimeService.name);
  private namespace: Namespace | null = null;
  private readonly clubUserSubscribers = new Map<
    number,
    Set<(payload: ServiceCallRealtimePayload) => void>
  >();
  private unsubscribeRedis: (() => Promise<void>) | null = null;

  constructor(private readonly redisService: RedisService) {}

  async onModuleInit(): Promise<void> {
    this.unsubscribeRedis = await this.redisService.subscribe(
      REALTIME_CHANNEL,
      (message) => this.handleRedisMessage(message),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.unsubscribeRedis?.();
    this.unsubscribeRedis = null;
  }

  bindNamespace(namespace: Namespace): void {
    this.namespace = namespace;
  }

  storeRoom(storeId: number): string {
    return `service-call:store:${storeId}`;
  }

  clubUserRoom(clubUserId: number): string {
    return `service-call:club-user:${clubUserId}`;
  }

  publishCreated(payload: ServiceCallRealtimePayload): void {
    void this.publish('service_call.created', payload);
  }

  publishUpdated(payload: ServiceCallRealtimePayload): void {
    void this.publish('service_call.updated', payload);
  }

  subscribeClubUser(
    clubUserId: number,
    listener: (payload: ServiceCallRealtimePayload) => void,
  ): () => void {
    const listeners = this.clubUserSubscribers.get(clubUserId) ?? new Set();
    listeners.add(listener);
    this.clubUserSubscribers.set(clubUserId, listeners);
    return (): void => {
      const current = this.clubUserSubscribers.get(clubUserId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.clubUserSubscribers.delete(clubUserId);
    };
  }

  private async publish(
    event: ServiceCallRealtimeEvent,
    payload: ServiceCallRealtimePayload,
  ): Promise<void> {
    try {
      await this.redisService.publish(
        REALTIME_CHANNEL,
        JSON.stringify({ event, payload }),
      );
    } catch (error: unknown) {
      this.logger.error(
        `发布服务呼叫实时事件失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private handleRedisMessage(message: string): void {
    try {
      const { event, payload } = JSON.parse(message) as RealtimeMessage;
      if (!payload?.storeId) return;
      if (event === 'service_call.updated') {
        this.logger.log(
          `收到 service_call.updated: serviceCallId=${payload.id}, status=${payload.status}, clubUserId=${String(payload.clubUserId)}, storeId=${payload.storeId}, namespaceReady=${Boolean(this.namespace)}, pid=${process.pid}`,
        );
      }
      this.namespace?.to(this.storeRoom(payload.storeId)).emit(event, payload);
      if (payload.clubUserId) {
        const room = this.clubUserRoom(payload.clubUserId);
        this.logger.log(
          `向 Club 服务呼叫房间广播: serviceCallId=${payload.id}, room=${room}, status=${payload.status}, pid=${process.pid}`,
        );
        this.namespace?.to(room).emit(event, payload);
        for (const listener of this.clubUserSubscribers.get(
          payload.clubUserId,
        ) ?? []) {
          listener(payload);
        }
      }
    } catch (error) {
      this.logger.error(
        `解析服务呼叫实时事件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}
