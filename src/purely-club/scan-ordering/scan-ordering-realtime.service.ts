import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';

export const SCAN_ORDERING_NAMESPACE = '/scan-ordering';
const REALTIME_CHANNEL = 'purelyprofit:scan-ordering:realtime:v1';

type RealtimeEvent =
  | 'order.created'
  | 'order.status_changed'
  | 'service_call.created'
  | 'service_call.updated';

interface RealtimeMessage {
  event: RealtimeEvent;
  payload: Record<string, unknown>;
}

@Injectable()
export class ScanOrderingRealtimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(ScanOrderingRealtimeService.name);
  private namespace: Namespace | null = null;
  private socketIoAdapterReady = false;
  private socketIoAdapterReadyResolver: (() => void) | null = null;
  private readonly socketIoAdapterReadyPromise = new Promise<void>(
    (resolve) => {
      this.socketIoAdapterReadyResolver = resolve;
    },
  );
  private unsubscribeRedis: (() => Promise<void>) | null = null;
  private readonly nativeOrderSubscribers = new Map<
    number,
    Set<(payload: unknown) => void>
  >();

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

  // 只能保存 /scan-ordering Namespace；使用顶层 Server 会把事件发到默认 / namespace。
  bindNamespace(namespace: Namespace): void {
    this.namespace = namespace;
  }

  markSocketIoAdapterReady(): void {
    this.socketIoAdapterReady = true;
    this.socketIoAdapterReadyResolver?.();
    this.socketIoAdapterReadyResolver = null;
  }

  async checkReadiness(): Promise<void> {
    if (!this.unsubscribeRedis || !this.socketIoAdapterReady) {
      throw new Error('扫码点餐实时订阅或 Socket.IO Redis adapter 尚未建立');
    }
    await this.redisService.checkReadiness();
  }

  publishOrderStatusChanged(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    refundSucceededAt?: string | null;
  }): void {
    this.publish('order.status_changed', payload);
  }

  publishOrderCreated(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
  }): void {
    this.publish('order.created', payload);
  }

  publishServiceCallCreated(payload: {
    storeId: number;
    sessionId: number;
    serviceCallId: number;
    type: string;
    remark: string | null;
  }): void {
    this.publish('service_call.created', payload);
  }

  publishServiceCallUpdated(payload: {
    storeId: number;
    sessionId: number;
    serviceCallId: number;
    status: string;
  }): void {
    this.publish('service_call.updated', payload);
  }

  subscribeNativeOrder(
    orderId: number,
    listener: (payload: unknown) => void,
  ): () => void {
    const listeners = this.nativeOrderSubscribers.get(orderId) ?? new Set();
    listeners.add(listener);
    this.nativeOrderSubscribers.set(orderId, listeners);
    return () => {
      const current = this.nativeOrderSubscribers.get(orderId);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) this.nativeOrderSubscribers.delete(orderId);
    };
  }

  storeRoom(storeId: number): string {
    return `store:${storeId}`;
  }

  orderRoom(orderId: number): string {
    return `order:${orderId}`;
  }

  sessionRoom(sessionId: number): string {
    return `session:${sessionId}`;
  }

  private publish(
    event: RealtimeEvent,
    payload: Record<string, unknown>,
  ): void {
    void this.publishAsync(event, payload);
  }

  private async publishAsync(
    event: RealtimeEvent,
    payload: Record<string, unknown>,
  ): Promise<void> {
    try {
      if (event === 'order.created') {
        this.logger.log(
          `发布 order.created 至 Redis: storeId=${String(payload.storeId)}, orderId=${String(payload.orderId)}, pid=${process.pid}`,
        );
      }
      await this.redisService.publish(
        REALTIME_CHANNEL,
        JSON.stringify({ event, payload }),
      );
    } catch (error) {
      this.logger.error(
        `发布扫码点餐实时事件失败: ${error instanceof Error ? error.message : String(error)}`,
        error instanceof Error ? error.stack : undefined,
      );
    }
  }

  private handleRedisMessage(message: string): void {
    try {
      const realtimeMessage = JSON.parse(message) as RealtimeMessage;
      this.dispatch(realtimeMessage);
    } catch (error) {
      this.logger.error(
        `解析扫码点餐实时事件失败: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private dispatch(message: RealtimeMessage): void {
    void this.dispatchWhenSocketIoReady(message);
  }

  private async dispatchWhenSocketIoReady(
    message: RealtimeMessage,
  ): Promise<void> {
    await this.socketIoAdapterReadyPromise;
    const { event, payload } = message;
    const storeId = this.numberValue(payload.storeId);
    const orderId = this.numberValue(payload.orderId);
    const sessionId = this.numberValue(payload.sessionId);

    if (event === 'order.created') {
      this.logger.log(
        `分发 order.created: storeId=${String(storeId)}, orderId=${String(orderId)}, namespaceReady=${Boolean(this.namespace)}, pid=${process.pid}`,
      );
    }
    if (storeId)
      this.namespace?.to(this.storeRoom(storeId)).emit(event, payload);
    if (event === 'order.status_changed' && orderId) {
      this.namespace?.to(this.orderRoom(orderId)).emit(event, payload);
      this.publishToNativeOrderSubscribers(orderId, { type: event, payload });
    }
    if (sessionId)
      this.namespace?.to(this.sessionRoom(sessionId)).emit(event, payload);
  }

  private numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : null;
  }

  private publishToNativeOrderSubscribers(
    orderId: number,
    message: unknown,
  ): void {
    const listeners = this.nativeOrderSubscribers.get(orderId);
    const connectionCount = listeners?.size ?? 0;
    this.logger.log(
      `原生订单 WebSocket 推送: orderId=${orderId}, connections=${connectionCount}, pid=${process.pid}`,
    );
    for (const listener of listeners ?? []) {
      listener(message);
    }
  }
}
