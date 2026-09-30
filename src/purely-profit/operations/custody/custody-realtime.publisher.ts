// 客存 B 端实时推送出口：把「存单数据 → 事件载荷」的拼装集中在此，
// 让写入 / 核销服务聚焦在事务与状态流转上。
//
// 时间字段一律由调用方传入后端生成的 Date，在此转 ISO，禁止前端造业务时间。
import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { CustodyRealtimeService } from '../../../purely-club/custody/custody-realtime.service';

/** 建单推送所需的最小存单字段 */
export interface CustodyStoreRequestSource {
  id: number;
  orderNo: string;
  productName: string;
  specName: string | null;
  unit: string;
  totalQty: number;
  location: string | null;
  expireAt: Date | null;
  memberId: number | null;
}

/** 作废推送所需的最小存单字段 */
export interface CustodyVoidSource {
  id: number;
  orderNo: string;
  /** 商品名：会员侧提示需指明被作废的是哪一笔 */
  productName: string;
  memberId: number | null;
}

/** 核销推送所需的最小存单字段 */
export interface CustodyPickedSource {
  id: number;
  orderNo: string;
  productName: string;
  unit: string;
  memberId: number | null;
}

@Injectable()
export class CustodyRealtimePublisher {
  private readonly logger = new Logger(CustodyRealtimePublisher.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtimeService: CustodyRealtimeService,
  ) {}

  /** 待确认存单：推给会员小程序弹确认层，避免店员口头报 6 位码 */
  async publishStoreRequested(
    storeId: number,
    order: CustodyStoreRequestSource,
  ): Promise<void> {
    if (order.memberId === null) {
      // 诊断：无会员归属的存单永远推不到小程序，此前静默 return、全链路无痕
      this.logger.warn(
        `[custody-realtime] 存单无会员归属，跳过推送: storeId=${storeId}, orderNo=${order.orderNo}`,
      );
      return;
    }
    this.realtimeService.publishStoreRequested(storeId, order.memberId, {
      custodyOrderId: order.id,
      orderNo: order.orderNo,
      storeId,
      storeName: await this.resolveStoreName(storeId),
      productName: order.productName,
      specName: order.specName ?? '',
      unit: order.unit,
      qty: order.totalQty,
      location: order.location ?? '',
      expireAt: order.expireAt?.toISOString() ?? '',
      memberId: order.memberId,
    });
  }

  /** 作废存单：会员侧知情（取件码全部失效），门店侧刷新 */
  publishVoided(
    storeId: number,
    order: CustodyVoidSource,
    reason: string,
    voidedAt: Date,
  ): void {
    this.realtimeService.publishVoided(storeId, order.memberId, {
      custodyOrderId: order.id,
      orderNo: order.orderNo,
      productName: order.productName,
      reason,
      voidedAt: voidedAt.toISOString(),
    });
  }

  /** 核销完成：会员侧知情（防冒领），门店侧刷新 */
  async publishPicked(
    storeId: number,
    order: CustodyPickedSource,
    qty: number,
    remainingQty: number,
    operatorName: string,
    pickedAt: Date,
  ): Promise<void> {
    this.realtimeService.publishPicked(storeId, order.memberId, {
      custodyOrderId: order.id,
      orderNo: order.orderNo,
      qty,
      remainingQty,
      unit: order.unit,
      productName: order.productName,
      pickedAt: pickedAt.toISOString(),
      storeName: await this.resolveStoreName(storeId),
      operatorName,
    });
  }

  /** 推送载荷需要门店名；取不到时降级为空串，不阻断主流程 */
  private async resolveStoreName(storeId: number): Promise<string> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { name: true },
    });
    return store?.name ?? '';
  }
}
