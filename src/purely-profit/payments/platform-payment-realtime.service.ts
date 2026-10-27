// 平台收款实时推送：微信回调入账成功后主动推送给发起支付的页面，替代前端轮询。
//
// 与客存实时链路同构：业务侧 publish → Redis Pub/Sub → 各 Worker 本地按房间投递，
// 保证多 Worker 部署时「回调落在 A、连接在 B」也能送达。
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';

/** 平台收款 Socket.IO 命名空间：与客存、扫码点餐隔离，权限边界互不影响 */
export const PROFIT_PAYMENT_NAMESPACE = '/profit-payments';

/** 平台收款实时事件 Redis 频道（各业务域独立频道，避免互相唤醒） */
const REALTIME_CHANNEL = 'purelyprofit:profit-payment:realtime:v1';

/** 实时事件名（与前端监听名一一对应，改动即破坏契约） */
export type ProfitPaymentRealtimeEvent =
  | 'payment.paid'
  | 'payment.failed'
  | 'payment.closed';

/** 支付结果载荷：状态取自支付单终态，前端不再自行轮询 */
export interface ProfitPaymentRealtimePayload {
  /** 平台支付单号 */
  orderNo: string;
  /** 支付单终态 */
  status: 'paid' | 'failed' | 'closed';
  /** 到账时间 ISO 字符串；未到账为 null */
  paidAt: string | null;
}

/** 跨 Worker 消息信封：orderNo 是投递路由，payload 是业务契约 */
interface RealtimeMessage {
  event: ProfitPaymentRealtimeEvent;
  payload: ProfitPaymentRealtimePayload;
  orderNo: string;
}

@Injectable()
export class PlatformPaymentRealtimeService
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PlatformPaymentRealtimeService.name);
  private namespace: Namespace | null = null;
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

  /** 由网关 afterInit 注入命名空间；未注入时仅广播 Redis，不本地投递 */
  bindNamespace(namespace: Namespace): void {
    this.namespace = namespace;
  }

  /** 支付单房间：只有发起该单的商家端连接会加入（见网关归属校验） */
  orderRoom(orderNo: string): string {
    return `profit:payment:${orderNo}`;
  }

  /** 入账成功 */
  publishPaid(orderNo: string, paidAt: string | null): void {
    void this.publish('payment.paid', orderNo, {
      orderNo,
      status: 'paid',
      paidAt,
    });
  }

  /** 入账失败（回调异常 / 业务类型未接入等） */
  publishFailed(orderNo: string): void {
    void this.publish('payment.failed', orderNo, {
      orderNo,
      status: 'failed',
      paidAt: null,
    });
  }

  /** 支付单关闭（超时未付） */
  publishClosed(orderNo: string): void {
    void this.publish('payment.closed', orderNo, {
      orderNo,
      status: 'closed',
      paidAt: null,
    });
  }

  private async publish(
    event: ProfitPaymentRealtimeEvent,
    orderNo: string,
    payload: ProfitPaymentRealtimePayload,
  ): Promise<void> {
    const message: RealtimeMessage = { event, payload, orderNo };
    this.logger.debug(
      `[profit-payment-realtime] 发布: event=${event}, orderNo=${orderNo}`,
    );
    try {
      await this.redisService.publish(
        REALTIME_CHANNEL,
        JSON.stringify(message),
      );
    } catch (error: unknown) {
      // 推送失败不能影响入账主流程，仅告警（前端仍有超时兜底提示）
      this.logger.warn(
        `[profit-payment-realtime] 发布失败 event=${event}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private handleRedisMessage(raw: string): void {
    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw) as RealtimeMessage;
    } catch {
      this.logger.warn('[profit-payment-realtime] 收到无法解析的消息，已忽略');
      return;
    }
    // `.local` 确保只投递本 Worker 持有的连接，Redis 已完成跨 Worker 扇出
    this.namespace
      ?.to(this.orderRoom(message.orderNo))
      .local.emit(message.event, message.payload);
  }
}
