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
  | 'service_call.updated'
  | 'voucher_order.created'
  | 'voucher_order.confirmed'
  | 'voucher_order.status_changed';

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

  publishOrderStatusChanged(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    /** 订单乐观锁版本；状态变更事件提供，历史兼容事件可不提供。 */
    version?: number;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    refundSucceededAt?: string | null;
    /** 取餐号（新增可选字段，兼容旧客户端）。 */
    pickupNumber?: number | null;
    pickupNumberLabel?: string | null;
    pickupNumberStatus?:
      | 'assigned'
      | 'called'
      | 'completed'
      | 'cancelled'
      | null;
    pickupCalledAt?: string | null;
    pickupCompletedAt?: string | null;
    /** 门店语音播报开关只读快照（后端门店配置为准，C 端据此决定是否弹取餐通知）。 */
    pickupVoiceEnabled?: boolean;
  }): void {
    this.publish('order.status_changed', payload);
  }

  publishOrderCreated(payload: {
    storeId: number;
    orderId: number;
    sessionId: number | null;
    /** 订单乐观锁版本；创建事件可不提供，状态变更事件会提供真实版本。 */
    version?: number;
    status: string;
    paymentStatus: string;
    fulfillmentStatus: string;
    /** 取餐号（新增可选字段，创建时通常为 null，兼容旧客户端）。 */
    pickupNumber?: number | null;
    pickupNumberLabel?: string | null;
    pickupNumberStatus?:
      | 'assigned'
      | 'called'
      | 'completed'
      | 'cancelled'
      | null;
    pickupCalledAt?: string | null;
    pickupCompletedAt?: string | null;
    /** 门店语音播报开关只读快照（后端门店配置为准）。 */
    pickupVoiceEnabled?: boolean;
  }): void {
    this.publish('order.created', payload);
  }

  /** 团购券新订单创建（purelyClub 支付成功后广播，商家端全局通知） */
  publishVoucherOrderCreated(payload: {
    /** 门店 ID */
    storeId: number;
    /** 业务订单号 */
    orderNo: string;
    /** 团购券码 */
    voucherCode: string;
    /** 顾客姓名 */
    guestName: string | null;
    /** 客人电话 */
    guestPhone: string | null;
    /** 商品名称 */
    productName: string;
    /** 商品分类名（团购券类型，如小包/中包） */
    categoryName: string | null;
    /** 购买数量 */
    quantity: number;
    /** 下单时间 ISO */
    createdAt: string;
  }): void {
    this.publish('voucher_order.created', payload);
  }

  /** 团购券订单商家确认（仅记录确认信息，不改变订单状态） */
  publishVoucherOrderConfirmed(payload: {
    /** 门店 ID */
    storeId: number;
    /** 业务订单号 */
    orderNo: string;
    /** 确认时间 ISO */
    confirmedAt: string;
    /** 确认操作员姓名 */
    confirmedByStaffName: string;
  }): void {
    this.publish('voucher_order.confirmed', payload);
  }

  /** 团购券订单状态变更（开台核销 used / 商家拒绝退款 refunded） */
  publishVoucherOrderStatusChanged(payload: {
    /** 门店 ID */
    storeId: number;
    /** 业务订单号 */
    orderNo: string;
    /** 团购券码 */
    voucherCode: string;
    /** 新状态（used=开台核销 refunded=商家拒绝退款） */
    status: 'used' | 'refunded';
    /** 使用时间 ISO */
    usedAt?: string;
    /** 使用门店名称 */
    usedStoreName?: string;
    /** 退款时间 ISO（status=refunded 时携带） */
    refundAt?: string;
    /** 拒绝时间 ISO（商家拒绝退款时携带） */
    rejectedAt?: string;
    /** 拒绝操作员姓名（商家拒绝退款时携带） */
    rejectedByStaffName?: string | null;
  }): void {
    this.publish('voucher_order.status_changed', payload);
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

  subscribeNativeVoucherOrder(
    orderNo: string,
    listener: (payload: unknown) => void,
  ): () => void {
    const listeners =
      this.nativeVoucherOrderSubscribers.get(orderNo) ?? new Set();
    listeners.add(listener);
    this.nativeVoucherOrderSubscribers.set(orderNo, listeners);
    return () => {
      const current = this.nativeVoucherOrderSubscribers.get(orderNo);
      if (!current) return;
      current.delete(listener);
      if (current.size === 0)
        this.nativeVoucherOrderSubscribers.delete(orderNo);
    };
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
    if (
      event === 'voucher_order.created' ||
      event === 'voucher_order.confirmed' ||
      event === 'voucher_order.status_changed'
    ) {
      const orderNo = this.stringValue(payload.orderNo);
      if (orderNo) {
        // 商家端订阅 store 房间：created（新订单通知）/ confirmed（列表刷新）/ status_changed（退款后列表刷新）
        if (storeId)
          this.namespace?.to(this.storeRoom(storeId)).emit(event, payload);
        if (event === 'voucher_order.status_changed') {
          // 用户端订阅 voucher-order 房间 + native 订阅者：订单详情自动刷新
          this.namespace
            ?.to(this.voucherOrderRoom(orderNo))
            .emit(event, payload);
          this.publishToNativeVoucherOrderSubscribers(orderNo, {
            type: event,
            payload,
          });
        }
      }
    }
    if (sessionId)
      this.namespace?.to(this.sessionRoom(sessionId)).emit(event, payload);
  }

  private numberValue(value: unknown): number | null {
    return typeof value === 'number' && Number.isInteger(value) && value > 0
      ? value
      : null;
  }

  private stringValue(value: unknown): string | null {
    return typeof value === 'string' && value.length > 0 ? value : null;
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
