// 客存实时推送服务：业务侧 publish → Redis Pub/Sub → 各 Worker 本地按房间投递。
//
// 房间口径（T0-1 定案，分支 B）：
// - B 端 `custody:store:{storeId}`
// - C 端 `custody:member:{memberId}`：memberId 由「门店 + 手机号」定位，
//   天然限定门店，杜绝跨店跨会员串号。
//
// C 端微信小程序不能走 Socket.IO，由 `/api/ws/custody` 原生 WebSocket
// 通过 subscribeMember() 走同一条 Redis 分发链路。
import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { RedisService } from '../../redis/redis.service';

/** 客存 Socket.IO 命名空间：与扫码点餐、服务呼叫隔离，权限边界互不影响 */
export const CUSTODY_NAMESPACE = '/custody';

/** 客存实时事件 Redis 频道（各业务域独立频道，避免互相唤醒） */
const REALTIME_CHANNEL = 'purelyprofit:custody:realtime:v1';

/** 客存实时事件名（与前端监听名一一对应，改动即破坏契约） */
export type CustodyRealtimeEvent =
  | 'custody.store_requested'
  | 'custody.store_confirmed'
  | 'custody.store_rejected'
  | 'custody.pickup_code_created'
  | 'custody.picked'
  | 'custody.voided';

/** 店员发起存入：推给会员（待确认）与门店（等待态） */
export interface CustodyStoreRequestedPayload {
  custodyOrderId: number;
  orderNo: string;
  storeId: number;
  storeName: string;
  productName: string;
  specName: string;
  unit: string;
  qty: number;
  location: string;
  /** 到期时间 ISO 字符串（后端生成），空串表示长期有效 */
  expireAt: string;
  memberId: number;
}

/** 会员确认存入：仅门店侧等待态流转 */
export interface CustodyStoreConfirmedPayload {
  custodyOrderId: number;
  orderNo: string;
  confirmedAt: string;
  memberId: number;
}

/** 会员拒绝存入：仅门店侧等待态流转 */
export interface CustodyStoreRejectedPayload {
  custodyOrderId: number;
  orderNo: string;
  rejectedAt: string;
  memberId: number;
}

/** 会员生成取件码：门店侧可提前备货 */
export interface CustodyPickupCodeCreatedPayload {
  custodyOrderId: number;
  orderNo: string;
  expiresAt: string;
}

/** 店员完成取出：会员侧知情（防冒领），门店侧刷新列表 */
export interface CustodyPickedPayload {
  custodyOrderId: number;
  orderNo: string;
  qty: number;
  remainingQty: number;
  unit: string;
  productName: string;
  pickedAt: string;
  storeName: string;
  operatorName: string;
}

/** 店员作废存单：会员侧知情，门店侧刷新列表 */
export interface CustodyVoidedPayload {
  custodyOrderId: number;
  orderNo: string;
  /** 商品名：会员侧提示需要指明是哪一笔存单被作废 */
  productName: string;
  reason: string;
  voidedAt: string;
}

/** 全部客存事件载荷（投递时原样下发，前端按事件名收窄） */
export type CustodyRealtimePayload =
  | CustodyStoreRequestedPayload
  | CustodyStoreConfirmedPayload
  | CustodyStoreRejectedPayload
  | CustodyPickupCodeCreatedPayload
  | CustodyPickedPayload
  | CustodyVoidedPayload;

/** C 端原生 WebSocket 订阅回调 */
export type CustodyMemberListener = (
  event: CustodyRealtimeEvent,
  payload: CustodyRealtimePayload,
) => void;

/**
 * 跨 Worker 消息信封。
 *
 * storeId / targetMemberId 是**投递路由**，不属于 C 端业务契约：
 * targetMemberId 为 null 表示该事件只下发给门店（confirmed / rejected），
 * 因此它与 payload.memberId（业务归属）语义不同，不可合并。
 */
interface RealtimeMessage {
  event: CustodyRealtimeEvent;
  payload: CustodyRealtimePayload;
  storeId: number;
  targetMemberId: number | null;
}

@Injectable()
export class CustodyRealtimeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CustodyRealtimeService.name);
  private namespace: Namespace | null = null;
  /** C 端原生 WebSocket 订阅者：memberId → 监听器（socket 断开即注销） */
  private readonly memberSubscribers = new Map<
    number,
    Set<CustodyMemberListener>
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
    this.memberSubscribers.clear();
  }

  /** 由网关 afterInit 注入命名空间；未注入时仅广播 Redis，不本地投递 */
  bindNamespace(namespace: Namespace): void {
    this.namespace = namespace;
  }

  /** B 端门店房间 */
  storeRoom(storeId: number): string {
    return `custody:store:${storeId}`;
  }

  /** C 端会员房间（memberId 已限定门店） */
  memberRoom(memberId: number): string {
    return `custody:member:${memberId}`;
  }

  /** 店员发起存入：C 端弹确认层 + B 端转等待态 */
  publishStoreRequested(
    storeId: number,
    memberId: number,
    payload: CustodyStoreRequestedPayload,
  ): void {
    void this.publish('custody.store_requested', storeId, memberId, payload);
  }

  /** 会员确认存入：仅 B 端 */
  publishStoreConfirmed(
    storeId: number,
    payload: CustodyStoreConfirmedPayload,
  ): void {
    void this.publish('custody.store_confirmed', storeId, null, payload);
  }

  /** 会员拒绝存入：仅 B 端 */
  publishStoreRejected(
    storeId: number,
    payload: CustodyStoreRejectedPayload,
  ): void {
    void this.publish('custody.store_rejected', storeId, null, payload);
  }

  /** 会员生成取件码：仅 B 端 */
  publishPickupCodeCreated(
    storeId: number,
    payload: CustodyPickupCodeCreatedPayload,
  ): void {
    void this.publish('custody.pickup_code_created', storeId, null, payload);
  }

  /** 店员完成取出：B 端 + C 端（会员需知情） */
  publishPicked(
    storeId: number,
    memberId: number | null,
    payload: CustodyPickedPayload,
  ): void {
    void this.publish('custody.picked', storeId, memberId, payload);
  }

  /** 店员作废存单：B 端 + C 端 */
  publishVoided(
    storeId: number,
    memberId: number | null,
    payload: CustodyVoidedPayload,
  ): void {
    void this.publish('custody.voided', storeId, memberId, payload);
  }

  /** C 端原生 WebSocket 订阅；返回注销函数（必须在 socket 关闭时调用） */
  subscribeMember(
    memberId: number,
    listener: CustodyMemberListener,
  ): () => void {
    const listeners = this.memberSubscribers.get(memberId) ?? new Set();
    listeners.add(listener);
    this.memberSubscribers.set(memberId, listeners);
    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) this.memberSubscribers.delete(memberId);
    };
  }

  private async publish(
    event: CustodyRealtimeEvent,
    storeId: number,
    targetMemberId: number | null,
    payload: CustodyRealtimePayload,
  ): Promise<void> {
    const message: RealtimeMessage = {
      event,
      payload,
      storeId,
      targetMemberId,
    };
    this.logger.debug(
      `[custody-realtime] 发布: event=${event}, storeId=${storeId}, ` +
        `targetMemberId=${targetMemberId ?? '-'}`,
    );
    try {
      await this.redisService.publish(
        REALTIME_CHANNEL,
        JSON.stringify(message),
      );
    } catch (error: unknown) {
      // 推送失败不能影响存入/核销主流程，仅告警
      this.logger.warn(
        `[custody-realtime] 发布失败 event=${event}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  private handleRedisMessage(raw: string): void {
    let message: RealtimeMessage;
    try {
      message = JSON.parse(raw) as RealtimeMessage;
    } catch {
      this.logger.warn('[custody-realtime] 收到无法解析的消息，已忽略');
      return;
    }
    const { event, payload, storeId, targetMemberId } = message;

    // 诊断：小程序原生通道的订阅者是本 Worker 的内存表，这里把「消息收到了但本地
    // 无人接」（跨 Worker、连接已断、memberId 不匹配的直接证据）显式暴露出来。
    this.logger.debug(
      `[custody-realtime] 收到扇出: event=${event}, storeId=${storeId}, ` +
        `targetMemberId=${targetMemberId ?? '-'}, 本地订阅者=` +
        `${targetMemberId === null ? 0 : (this.memberSubscribers.get(targetMemberId)?.size ?? 0)}`,
    );

    // `.local` 确保只投递本 Worker 持有的连接，Redis 已完成跨 Worker 扇出
    this.namespace?.to(this.storeRoom(storeId)).local.emit(event, payload);

    if (targetMemberId === null) return;
    this.namespace
      ?.to(this.memberRoom(targetMemberId))
      .local.emit(event, payload);
    const listeners = this.memberSubscribers.get(targetMemberId);
    if (!listeners) return;
    for (const listener of listeners) {
      try {
        listener(event, payload);
      } catch (error: unknown) {
        this.logger.warn(
          `[custody-realtime] 原生订阅回调异常 memberId=${targetMemberId}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
  }
}
