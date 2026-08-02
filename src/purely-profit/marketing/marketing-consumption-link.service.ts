import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Money } from '../../shared/money.utils';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { CacheInvalidatorService } from '../../redis/cache-invalidator.service';
import {
  buildMarketingCustomersListPattern,
  buildMarketingCustomerDetailPattern,
} from '../../redis/cache-keys';
import {
  calcCustomerTier,
  type MarketingPayTypeValue,
} from './marketing.utils';

/**
 * 空间结算联动营销中心的入参。
 */
export interface LinkSpaceSettlementConsumptionParams {
  storeId: number;
  /** 客人姓名（可为空，用于创建会员时的默认昵称） */
  guestName?: string | null;
  /** 客人手机号（联动前提：非空才创建/关联会员） */
  guestPhone?: string | null;
  /** 结算实收金额（元，含商品与时长费用，退款/纯抵扣时可能为 0 或负数） */
  totalRevenueYuan: number;
  /** 结算支付方式（SalesPaymentMethodValue） */
  paymentMethod: string;
  /** 结算时间戳（ms），用于 lastVisitAt */
  checkoutAt: number;
  /** 消费摘要（如商品清单简述） */
  itemsSummary?: string;
}

/**
 * 空间支付方式 → 营销消费支付方式映射。
 * 营销侧枚举仅 balance/cash/wechat/alipay/mixed，空间侧 card 与团购券统一归入 cash。
 */
const SPACE_TO_MARKETING_PAY_TYPE: Record<string, MarketingPayTypeValue> = {
  cash: 'cash',
  wechat: 'wechat',
  alipay: 'alipay',
  card: 'cash',
  groupon_voucher: 'cash',
};

/**
 * 跨域联动服务：把空间管理（非餐饮）结算写入营销中心会员体系。
 *
 * 目标：空间顾客在结算时按「门店 + 手机号」自动创建/关联 MarketingCustomer，
 * 并把结算实收金额全额计入累计消费（totalSpent）、消费次数（visitCount + 1）、
 * 最后消费时间（lastVisitAt）与会员等级（tier），同时写入 marketing_consumptions 流水。
 *
 * 与餐饮扫码点餐（resolveActiveCustomer）形成对称链路，保证两类账号在
 * marketing-customers 页面都可以联动展示。
 */
@Injectable()
export class MarketingConsumptionLinkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  /**
   * 在事务内联动空间结算消费（DB 写入部分）。
   *
   * 约束：
   * - guestPhone 为空 → 跳过（手机号识别口径，无手机号客人不创建会员）
   * - 结算金额 <= 0 → 跳过（纯退款/纯抵扣不记消费，避免次数虚增）
   *
   * @param tx 空间结算事务客户端
   */
  async linkSpaceSettlementConsumption(
    tx: Prisma.TransactionClient,
    params: LinkSpaceSettlementConsumptionParams,
  ): Promise<void> {
    const phone = params.guestPhone?.trim();
    if (!phone) return;

    const amountCents = Money.fromInputYuan(params.totalRevenueYuan).toDbCents();
    if (amountCents <= 0) return;

    // 事务内按 门店 + 手机号 关联（兼容已有会员与新建会员）
    const existing = await tx.marketingCustomer.findFirst({
      where: { storeId: params.storeId, phone, deletedAt: null },
      select: { id: true, totalSpent: true },
    });

    const newTotalSpent = (existing?.totalSpent ?? 0) + amountCents;
    const newTier = calcCustomerTier(newTotalSpent) as never;

    let customerId: number;
    if (existing) {
      customerId = existing.id;
      await tx.marketingCustomer.update({
        where: { id: existing.id },
        data: {
          totalSpent: { increment: amountCents },
          visitCount: { increment: 1 },
          lastVisitAt: new Date(params.checkoutAt),
          tier: newTier,
        },
      });
    } else {
      const created = await tx.marketingCustomer.create({
        data: {
          storeId: params.storeId,
          name: params.guestName?.trim() || '空间顾客',
          phone,
          totalSpent: amountCents,
          visitCount: 1,
          lastVisitAt: new Date(params.checkoutAt),
          tier: newTier,
        },
      });
      customerId = created.id;
    }

    await tx.marketingConsumption.create({
      data: {
        storeId: params.storeId,
        customerId,
        amount: amountCents,
        balancePaid: 0,
        pointsDeducted: 0,
        payType: this.mapPaymentMethod(params.paymentMethod),
        itemsSummary: params.itemsSummary?.trim() || null,
      },
    });
  }

  /**
   * 空间结算提交后失效营销中心衍生缓存（overview / 顾客列表 / 顾客详情）。
   * 应在事务提交成功后、事务外调用。
   */
  async invalidateMarketingDerived(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      this.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      this.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
    ]);
  }

  private mapPaymentMethod(paymentMethod: string): MarketingPayTypeValue {
    return SPACE_TO_MARKETING_PAY_TYPE[paymentMethod] ?? 'cash';
  }
}
