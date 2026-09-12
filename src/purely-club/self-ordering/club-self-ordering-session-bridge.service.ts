import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { SESSION_ITEM_SOURCE_TYPE } from './club-self-ordering.utils';
import { deductInventoryForSaleBestEffort } from '../../purely-profit/goods/inventory/inventory-stock.query';

/** 待写入空间账单的订单行快照 */
export interface PaidOrderItemSnapshot {
  /** 订单行 ID，用于空间账单反查来源 */
  id: number;
  productId: string;
  productName: string;
  categoryName: string | null;
  /** 销售单价（分） */
  salePrice: number;
  /** 成本单价（分） */
  costPrice: number;
  quantity: number;
  /** 规格签名（选项 ID 升序 sha256）；无规格时为 null，参与空间账单合并键 */
  specSignature?: string | null;
  /** 规格名（如 ["大杯","热"]）；无规格时为空数组 */
  specNames?: string[];
}

/**
 * 自助下单 → 空间账单 桥接服务
 *
 * 支付成功后把订单商品行写入 SpaceSessionItem，使顾客自助购买的商品出现在
 * 空间会话账单里（结算时由 SYS_SELF_ORDER_DEDUCTION 抵扣行冲减，避免重复收费）。
 */
@Injectable()
export class ClubSelfOrderingSessionBridgeService {
  private readonly logger = new Logger(
    ClubSelfOrderingSessionBridgeService.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 将已支付订单的商品行写入空间会话账单
   *
   * 必须在调用方事务内执行（传入 tx），保证「订单落账」与「商品入账」原子，
   * 不出现「钱收了但商品没进账单」的中间态。
   *
   * 幂等：同一 sourceOrderNo 只录入一次 —— 支付回调重复触发时不会重复累加数量。
   */
  async appendPaidItemsToSession(
    tx: Prisma.TransactionClient,
    params: {
      sessionId: number;
      orderNo: string;
      /** 支付渠道：balance=储值余额 / wechat=微信支付；随行写入用于账单明细展示来源 */
      sourceChannel: 'balance' | 'wechat';
      items: PaidOrderItemSnapshot[];
    },
  ): Promise<void> {
    const { sessionId, orderNo, sourceChannel, items } = params;
    if (items.length === 0) return;

    const existing = await tx.spaceSessionItem.findFirst({
      where: { sessionId, sourceOrderNo: orderNo },
      select: { id: true },
    });
    if (existing) {
      this.logger.warn(
        `自助下单 ${orderNo} 已录入会话 ${sessionId}，跳过重复写入`,
      );
      return;
    }

    // 追加到账单末尾：取当前最大序号 +1，避免打乱既有明细顺序
    const maxSort = await tx.spaceSessionItem.aggregate({
      where: { sessionId },
      _max: { sortOrder: true },
    });
    let sortOrder = (maxSort._max.sortOrder ?? -1) + 1;

    await tx.spaceSessionItem.createMany({
      data: items.map((item) => ({
        sessionId,
        productId: item.productId,
        productName: item.productName,
        categoryName: item.categoryName ?? '',
        salePrice: item.salePrice,
        // profit 为单件利润（分），与空间管理「追加商品」的写入语义保持一致
        profit: item.salePrice - item.costPrice,
        quantity: item.quantity,
        sortOrder: sortOrder++,
        sourceType: SESSION_ITEM_SOURCE_TYPE,
        sourceChannel,
        sourceOrderNo: orderNo,
        sourceOrderItemId: item.id,
        specSignature: item.specSignature ?? null,
        // 规格名快照：无规格时保持 NULL（nullable Json 不写即 NULL）
        ...(item.specNames && item.specNames.length > 0
          ? { specNames: item.specNames }
          : {}),
      })),
    });

    const addedCost = items.reduce(
      (sum, item) => sum + item.salePrice * item.quantity,
      0,
    );
    await tx.spaceSession.update({
      where: { id: sessionId },
      data: { itemsCost: { increment: addedCost } },
    });

    // 同步扣减库存：自助下单与员工追加点单一样是真实销售，
    // 此前缺少这一步导致非餐饮门店库存不变（餐饮门店走扫码点餐预留，不受影响）。
    await this.deductPaidItemsInventory(tx, sessionId, items);
  }

  /**
   * 按订单行扣减商品库存（与入账同一事务，幂等短路在前，不会重复扣）
   *
   * 使用尽力而为扣减：支付已完成，库存不足或未维护库存都不能回滚落账，
   * 否则会出现「钱已收、账单未入账」的资金事故。
   */
  private async deductPaidItemsInventory(
    tx: Prisma.TransactionClient,
    sessionId: number,
    items: PaidOrderItemSnapshot[],
  ): Promise<void> {
    const session = await tx.spaceSession.findUnique({
      where: { id: sessionId },
      select: { storeId: true },
    });
    if (!session) return;

    // 只扣真实商品：跳过非数字 productId 与数量非正的行
    const inventoryItems = items
      .map((item) => ({
        productId: Number.parseInt(String(item.productId ?? '').trim(), 10),
        quantity: Math.max(0, Math.floor(item.quantity)),
        productName: item.productName,
      }))
      .filter(
        (item) =>
          Number.isInteger(item.productId) &&
          item.productId > 0 &&
          item.quantity > 0,
      );
    if (inventoryItems.length === 0) return;

    await deductInventoryForSaleBestEffort(
      tx,
      inventoryItems,
      session.storeId,
      null,
      '会员自助下单',
    );
  }
}
