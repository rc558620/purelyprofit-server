import { ConflictException, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { queryCustomerTierThresholds } from '../../purely-profit/marketing/marketing.query';
import { calcCustomerTier } from '../../purely-profit/marketing/marketing.utils';
import {
  awardPointsForSettlement,
  deductPointsForSettlement,
} from '../orders/club-order-settlement-points.utils';

/** 支付成功后的积分与消费落账入参。 */
export interface ScanOrderPointsSettlementInput {
  storeId: number;
  orderId: number;
  orderNo: string;
  customerId: number;
  /** 实付金额（分）：积分抵扣后的应付额。 */
  paidAmountFen: number;
  /** 本次抵扣的积分个数。 */
  pointsUsed: number;
  /** 本次抵扣对应的金额（分）。 */
  pointsDeductAmount: number;
  /** 支付渠道，决定 MarketingConsumption.payType。 */
  payType: 'balance' | 'wechat';
}

/** 支付成功后的积分与消费落账结果。 */
export interface ScanOrderPointsSettlementResult {
  earnedPoints: number;
}

@Injectable()
export class ClubScanOrderingMarketingCustomerService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 支付成功后统一落账：扣减抵扣积分、按实付金额赠送积分、写入消费记录。
   *
   * 必须与支付方式无关：订单 payableAmount 存的已经是「积分抵扣后」的金额
   * （见 ClubScanOrderingOrderService.create），因此无论余额还是微信支付，
   * 只要收的是 payableAmount，就必须扣掉 pointsUsed，否则顾客可无限白拿抵扣。
   * 三条支付路径（余额 / 微信回调 / 开发态确认）都必须调用本方法。
   */
  async settlePaidOrder(
    tx: Prisma.TransactionClient,
    input: ScanOrderPointsSettlementInput,
  ): Promise<ScanOrderPointsSettlementResult> {
    const context = {
      storeId: input.storeId,
      description: `扫码点餐订单 ${input.orderNo}`,
      paidAmountFen: input.paidAmountFen,
    };

    await deductPointsForSettlement(
      tx,
      context,
      input.customerId,
      input.pointsUsed,
    );
    const earnedPoints = await awardPointsForSettlement(
      tx,
      context,
      input.customerId,
    );

    await tx.marketingConsumption.create({
      data: {
        storeId: input.storeId,
        customerId: input.customerId,
        amount: input.paidAmountFen + input.pointsDeductAmount,
        balancePaid: input.payType === 'balance' ? input.paidAmountFen : 0,
        pointsDeducted: input.pointsDeductAmount,
        // 积分侧事实源：与 pointsDeducted（金额分）配合可独立核对抵扣比例
        actualPointsDeducted: input.pointsUsed,
        payType: input.payType,
        itemsSummary: context.description,
      },
    });

    // 物化指标必须与流水同口径更新：此前只写流水不更新 marketing_customers，
    // 导致读物化字段的页面（护理档案等）少算这次消费。
    const consumptionAmountFen = input.paidAmountFen + input.pointsDeductAmount;
    if (consumptionAmountFen > 0) {
      const customer = await tx.marketingCustomer.findFirst({
        where: { id: input.customerId, deletedAt: null },
        select: { id: true, totalSpent: true },
      });
      if (customer) {
        const thresholds = await queryCustomerTierThresholds(tx, input.storeId);
        await tx.marketingCustomer.update({
          where: { id: customer.id },
          data: {
            totalSpent: { increment: consumptionAmountFen },
            visitCount: { increment: 1 },
            lastVisitAt: new Date(),
            tier: calcCustomerTier(
              customer.totalSpent + consumptionAmountFen,
              thresholds,
            ) as never,
          },
        });
      }
    }

    return { earnedPoints };
  }

  /**
   * 定位（必要时创建）当前门店下该用户的营销顾客档案。
   *
   * 只有「归并 / 建档」这类写路径才需要事务：归并的并发安全由
   * {@link mergeIntoBoundCustomer} 的 CAS 保证，建档的并发安全由 upsert 保证，
   * 都不依赖事务隔离。因此把占绝大多数的只读路径摘到事务外——
   * preview / create / balance-payment 每次少付 BEGIN + COMMIT 两次往返，
   * 且绑定档案与 user 两次查询并行发起（原实现串行）。
   */
  async resolveActiveCustomer(
    storeId: number,
    clubUserId: number,
  ): Promise<{ id: number; balance: number; phone: string | null }> {
    const [boundCustomer, user] = await Promise.all([
      this.prisma.marketingCustomer.findFirst({
        where: { storeId, clubUserId, status: 'active', deletedAt: null },
        select: { id: true, balance: true, phone: true },
      }),
      // legacy 档案定位需要 wechatPhone，建档时需要 name。
      // 放在事务外读：它只是归并/建档的输入，不参与任何 CAS 条件。
      this.prisma.user.findUnique({
        where: { id: clubUserId },
        select: { name: true, wechatPhone: true },
      }),
    ]);

    // 同手机号的 legacy 档案：无论绑定档案是否已有余额都要合并。此前只在
    // 绑定档案余额为 0 时才走这里，导致「先绑定、后充值」的用户与同号历史
    // 档案长期并存（同人双档案、两条余额各算一份）。
    const legacyCustomer = user?.wechatPhone
      ? await this.prisma.marketingCustomer.findFirst({
          where: {
            storeId,
            clubUserId: null,
            phone: user.wechatPhone,
            status: 'active',
            deletedAt: null,
          },
          select: { id: true, balance: true, phone: true },
        })
      : null;

    // 快路径：绑定档案已存在、余额 > 0（无孤儿余额待归并）、无 legacy 档案可认领。
    if (boundCustomer && boundCustomer.balance > 0 && !legacyCustomer) {
      return boundCustomer;
    }

    // 无绑定档案也无 legacy 档案：只剩建档一步，upsert 自带幂等，无需事务。
    if (!boundCustomer && !legacyCustomer) {
      return this.createBoundCustomer(this.prisma, storeId, clubUserId, user);
    }

    const customer = await this.prisma.$transaction((tx) =>
      this.resolveCustomerWithMerge(
        tx,
        storeId,
        clubUserId,
        boundCustomer,
        legacyCustomer,
        user,
      ),
    );
    if (!customer) {
      throw new ConflictException(
        '当前门店未开通余额支付，请先完成会员绑定或充值',
      );
    }
    return customer;
  }

  /** 归并 / 认领 legacy 档案的写路径（需事务包裹）。 */
  private async resolveCustomerWithMerge(
    tx: Prisma.TransactionClient,
    storeId: number,
    clubUserId: number,
    boundCustomer: { id: number; balance: number; phone: string | null } | null,
    legacyCustomer: {
      id: number;
      balance: number;
      phone: string | null;
    } | null,
    user: { name: string | null; wechatPhone: string | null } | null,
  ): Promise<{ id: number; balance: number; phone: string | null } | null> {
    // 新注册账号可能在手机号尚未同步前完成充值，余额会落在一条未绑定的
    // 客户记录。仅在门店内唯一存在该类记录时归并，避免误合并其它客户余额。
    // 归并完成后绑定档案余额必 > 0，因此只在余额为 0 时尝试，让已归并过的
    // 用户直接跳过这两次查询。
    if (boundCustomer && boundCustomer.balance === 0) {
      const unboundFundedCustomers = await tx.marketingCustomer.findMany({
        where: {
          storeId,
          clubUserId: null,
          balance: { gt: 0 },
          status: 'active',
          deletedAt: null,
        },
        orderBy: { updatedAt: 'desc' },
        take: 2,
        select: { id: true, balance: true, phone: true },
      });
      if (unboundFundedCustomers.length === 1) {
        const merged = await this.mergeIntoBoundCustomer(
          tx,
          boundCustomer,
          unboundFundedCustomers[0],
        );
        if (merged) return merged;
      }
    }

    if (legacyCustomer) {
      if (boundCustomer) {
        const merged = await this.mergeIntoBoundCustomer(
          tx,
          boundCustomer,
          legacyCustomer,
        );
        if (merged) return merged;
      }
      const claimed = await tx.marketingCustomer.updateMany({
        where: { id: legacyCustomer.id, clubUserId: null },
        data: { clubUserId },
      });
      if (claimed.count > 0) return legacyCustomer;
    }

    if (boundCustomer) return boundCustomer;

    return this.createBoundCustomer(tx, storeId, clubUserId, user);
  }

  /**
   * 新建（或取回已存在的）绑定档案。
   *
   * 并发的订单预览请求可能都没有读到绑定记录；使用 upsert 防止其中一个
   * create 因 (storeId, clubUserId) 唯一约束失败。
   */
  private createBoundCustomer(
    client: Prisma.TransactionClient,
    storeId: number,
    clubUserId: number,
    user: { name: string | null; wechatPhone: string | null } | null,
  ): Promise<{ id: number; balance: number; phone: string | null }> {
    return client.marketingCustomer.upsert({
      where: { storeId_clubUserId: { storeId, clubUserId } },
      create: {
        storeId,
        clubUserId,
        name: user?.name?.trim() || 'Club 顾客',
        phone: user?.wechatPhone ?? null,
      },
      update: {},
      select: { id: true, balance: true, phone: true },
    });
  }

  /**
   * 把 source 档案的余额并入 boundCustomer，并软删 source。
   *
   * 并发防护：先以 CAS（balance + deleted_at 作为条件）抢占 source 档案。
   * 抢占失败说明另一个并发请求（订单预览与结算可能同时发起）已完成归并，
   * 此时改为重新读取绑定档案的实时余额返回；若两边都按各自读到的旧余额
   * increment，同一笔孤儿余额会被重复累加一次。
   */
  private async mergeIntoBoundCustomer(
    tx: Prisma.TransactionClient,
    boundCustomer: { id: number; balance: number; phone: string | null },
    source: { id: number; balance: number; phone: string | null },
  ): Promise<{ id: number; balance: number; phone: string | null } | null> {
    const claimed = await tx.marketingCustomer.updateMany({
      where: {
        id: source.id,
        clubUserId: null,
        balance: source.balance,
        deletedAt: null,
      },
      data: { status: 'inactive', deletedAt: new Date() },
    });
    if (claimed.count === 0) {
      return tx.marketingCustomer.findUnique({
        where: { id: boundCustomer.id },
        select: { id: true, balance: true, phone: true },
      });
    }

    await tx.marketingCustomer.update({
      where: { id: boundCustomer.id },
      data: {
        balance: { increment: source.balance },
        phone: source.phone ?? boundCustomer.phone,
      },
    });
    return {
      id: boundCustomer.id,
      balance: boundCustomer.balance + source.balance,
      phone: source.phone ?? boundCustomer.phone,
    };
  }
}
