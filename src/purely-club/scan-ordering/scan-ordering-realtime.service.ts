import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';
import type {
  OrderCreatedPayload,
  OrderStatusChangedPayload,
  RealtimeEvent,
  RealtimeMessage,
  SelfOrderCreatedPayload,
  SelfOrderStatusChangedPayload,
  ServiceCallCreatedPayload,
  ServiceCallUpdatedPayload,
  VoucherOrderConfirmedPayload,
  VoucherOrderCreatedPayload,
  VoucherOrderStatusChangedPayload,
} from './scan-ordering-realtime.types';

export const SCAN_ORDERING_NAMESPACE = '/scan-ordering';
const REALTIME_CHANNEL = 'purelyprofit:scan-ordering:realtime:v1';

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
  private readonly nativeVoucherOrderSubscribers = new Map<
    string,
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

  publishOrderStatusChanged(payload: OrderStatusChangedPayload): void {
    this.publish('order.status_changed', payload);
  }

  publishOrderCreated(payload: OrderCreatedPayload): void {
    this.publish('order.created', payload);
  }

  /** 团购券新订单创建（purelyClub 支付成功后广播，商家端全局通知） */
  publishVoucherOrderCreated(payload: VoucherOrderCreatedPayload): void {
    this.publish('voucher_order.created', payload);
  }

  /** 团购券订单商家确认（仅记录确认信息，不改变订单状态） */
  publishVoucherOrderConfirmed(payload: VoucherOrderConfirmedPayload): void {
    this.publish('voucher_order.confirmed', payload);
  }

  /** 团购券订单状态变更（开台核销 used / 商家拒绝退款 refunded） */
  publishVoucherOrderStatusChanged(
    payload: VoucherOrderStatusChangedPayload,
  ): void {
    this.publish('voucher_order.status_changed', payload);
  }

  publishServiceCallCreated(payload: ServiceCallCreatedPayload): void {
    this.publish('service_call.created', payload);
  }

  /** 自助下单新订单（purelyClub 支付成功后广播，商家端右下角弹窗） */
  publishSelfOrderCreated(payload: SelfOrderCreatedPayload): void {
    this.publish('self_order.created', payload);
  }

  /** 自助下单订单状态变更（当前仅支付成功与取消两种） */
  publishSelfOrderStatusChanged(payload: SelfOrderStatusChangedPayload): void {
    this.publish('self_order.status_changed', payload);
  }

  publishServiceCallUpdated(payload: ServiceCallUpdatedPayload): void {
    this.publish('service_call.updated', payload);
  }

  subscribeNativeOrder(
    orderId: number,
    listener: (payload: unknown) => void,
  ): () => void {
    return this.registerNativeSubscriber(
      this.nativeOrderSubscribers,
      orderId,
      listener,
    );
  }

  subscribeNativeVoucherOrder(
    orderNo: string,
    listener: (payload: unknown) => void,
  ): () => void {
    return this.registerNativeSubscriber(
      this.nativeVoucherOrderSubscribers,
      orderNo,
      listener,
    );
  }

  storeRoom(storeId: number): string {
    return `store:${storeId}`;
  }

  orderRoom(orderId: number): string {
    return `order:${orderId}`;
  }

  voucherOrderRoom(orderNo: string): string {
    return `voucher-order:${orderNo}`;
  }

  /** 团购券订单门店房间（商家端订阅，校验 space:view，与扫码点餐 store 房间隔离） */
  voucherOrderStoreRoom(storeId: number): string {
    return `voucher-store:${storeId}`;
  }

  /** 自助下单门店房间（商家端订阅，校验 self-ordering 权限，与其他业务房间隔离） */
  selfOrderingStoreRoom(storeId: number): string {
    return `self-ordering-store:${storeId}`;
  }

  sessionRoom(sessionId: number): string {
    return `session:${sessionId}`;
  }

  private publish(event: RealtimeEvent, payload: object): void {
    void this.publishAsync(event, payload);
  }

  private async publishAsync(
    event: RealtimeEvent,
    payload: object,
  ): Promise<void> {
    try {
      if (event === 'order.created') {
        const record = payload as Record<string, unknown>;
        this.logger.log(
          `发布 order.created 至 Redis: storeId=${String(record.storeId)}, orderId=${String(record.orderId)}, pid=${process.pid}`,
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
      this.namespace?.to(this.storeRoom(storeId)).local.emit(event, payload);
    if (event === 'order.status_changed' && orderId) {
      this.namespace?.to(this.orderRoom(orderId)).local.emit(event, payload);
      this.publishToNativeOrderSubscribers(orderId, { type: event, payload });
    }
    if (this.isVoucherOrderEvent(event)) {
      const orderNo = this.stringValue(payload.orderNo);
      if (orderNo) this.dispatchVoucherOrderEvent(event, payload, orderNo);
    }
    if (this.isSelfOrderEvent(event)) {
      // 商家端订阅 self-ordering-store 房间（校验 self-ordering 权限）：
      // created → 右下角弹窗 + 语音；status_changed → 列表/角标刷新
      if (storeId) {
        this.namespace
          ?.to(this.selfOrderingStoreRoom(storeId))
          .local.emit(event, payload);
      }
      // 自助下单的 sessionId 是 space_session ID，与扫码点餐会话是两套序列：
      // 不向 session 房间广播，避免跨门店同号会话收到无关事件（顾客端不订阅该房间）
    } else if (sessionId) {
      this.namespace
        ?.to(this.sessionRoom(sessionId))
        .local.emit(event, payload);
    }
  }

  private isVoucherOrderEvent(event: RealtimeEvent): boolean {
    return (
      event === 'voucher_order.created' ||
      event === 'voucher_order.confirmed' ||
      event === 'voucher_order.status_changed'
    );
  }

  private isSelfOrderEvent(event: RealtimeEvent): boolean {
    return (
      event === 'self_order.created' || event === 'self_order.status_changed'
    );
  }

  private dispatchVoucherOrderEvent(
    event: RealtimeEvent,
    payload: Record<string, unknown>,
    orderNo: string,
  ): void {
    const storeId = this.numberValue(payload.storeId);
    // 商家端订阅 voucher-store 房间（校验 space:view）：created（新订单通知）/
    // confirmed（列表刷新）/ status_changed（退款后列表刷新）
    if (storeId)
      this.namespace
        ?.to(this.voucherOrderStoreRoom(storeId))
        .local.emit(event, payload);
    if (event === 'voucher_order.status_changed') {
      // 用户端订阅 voucher-order 房间 + native 订阅者：订单详情自动刷新
      this.namespace
        ?.to(this.voucherOrderRoom(orderNo))
        .local.emit(event, payload);
      this.publishToNativeVoucherOrderSubscribers(orderNo, {
        type: event,
        payload,
      });
    }
  }

  private numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
  }

  private registerNativeSubscriber<K>(
    registry: Map<K, Set<(payload: unknown) => void>>,
    key: K,
    listener: (payload: unknown) => void,
  ): () => void {
    const listeners = registry.get(key) ?? new Set();
    listeners.add(listener);
    registry.set(key, listeners);
    return () => {
      const current = registry.get(key);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0) registry.delete(key);
    };
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

  private publishToNativeVoucherOrderSubscribers(
    orderNo: string,
    message: unknown,
  ): void {
    const listeners = this.nativeVoucherOrderSubscribers.get(orderNo);
    const connectionCount = listeners?.size ?? 0;
    this.logger.log(
      `原生团购券订单 WebSocket 推送: orderNo=${orderNo}, connections=${connectionCount}, pid=${process.pid}`,
    );
    for (const listener of listeners ?? []) {
      listener(message);
    }
  }
}
