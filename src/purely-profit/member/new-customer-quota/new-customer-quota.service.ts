// 新用户额度服务：余额查询 / 充值 / 会员赠送 / 清零 / 新客消耗（扣减幂等 + 防超卖）
import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import {
  NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
  NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
  NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
  RECHARGE_TIER_AMOUNT_FEN,
} from './new-customer-quota.constants';
import {
  calcQuotaByAmountFen,
  formatAmountFenToYuanDisplay,
  resolvePlanGrant,
  resolvePlanGrantLabel,
} from './new-customer-quota.domain';
import type {
  ConsumeNewCustomerQuotaResult,
  NewCustomerQuotaLogItem,
  NewCustomerQuotaLogTypeValue,
  NewCustomerQuotaOverview,
  NewCustomerQuotaTier,
} from './new-customer-quota.types';

const DEFAULT_LOG_LIMIT = 20;

const normalizeLogType = (rawType: string): NewCustomerQuotaLogTypeValue => {
  if (
    rawType === 'recharge' ||
    rawType === 'grant' ||
    rawType === 'consume' ||
    rawType === 'clear'
  ) {
    return rawType;
  }
  return 'consume';
};

@Injectable()
export class NewCustomerQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /** 额度概览：余额 + 累计充值/赠送/已服务新客 */
  async getOverview(storeId: number): Promise<NewCustomerQuotaOverview> {
    const [profile, recharged, granted] = await Promise.all([
      this.prisma.storeMembershipProfile.findUnique({
        where: { storeId },
        select: { newCustomerQuota: true, newCustomerQuotaConsumed: true },
      }),
      this.prisma.storeNewCustomerQuotaLog.aggregate({
        where: { storeId, type: 'recharge' },
        _sum: { changeAmount: true },
      }),
      this.prisma.storeNewCustomerQuotaLog.aggregate({
        where: { storeId, type: 'grant' },
        _sum: { changeAmount: true },
      }),
    ]);

    return {
      storeId,
      remaining: profile?.newCustomerQuota ?? 0,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      totalRecharged: recharged._sum.changeAmount ?? 0,
      totalGranted: granted._sum.changeAmount ?? 0,
      totalConsumed: profile?.newCustomerQuotaConsumed ?? 0,
    };
  }

  /** 充值档位：金额与可得新客数均由后端计算 */
  getTiers(): NewCustomerQuotaTier[] {
    return RECHARGE_TIER_AMOUNT_FEN.map((amountFen) => ({
      amountFen,
      amountDisplay: formatAmountFenToYuanDisplay(amountFen),
      quotaCount: calcQuotaByAmountFen(amountFen),
    }));
  }

  /** 额度流水（时间倒序） */
  async getLogs(
    storeId: number,
    limit: number = DEFAULT_LOG_LIMIT,
  ): Promise<NewCustomerQuotaLogItem[]> {
    const logs = await this.prisma.storeNewCustomerQuotaLog.findMany({
      where: { storeId },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit,
    });

    return logs.map((log) => ({
      id: log.id,
      type: normalizeLogType(log.type),
      changeAmount: log.changeAmount,
      balanceAfter: log.balanceAfter,
      description: log.description,
      createdAt: log.createdAt.toISOString(),
    }));
  }

  /** 剩余额度是否大于 0（用于 C 端绑定前预检） */
  async hasRemaining(storeId: number): Promise<boolean> {
    const profile = await this.prisma.storeMembershipProfile.findUnique({
      where: { storeId },
      select: { newCustomerQuota: true },
    });
    return (profile?.newCustomerQuota ?? 0) > 0;
  }

  /** 该手机号在本店是否属于新客（消费档案不存在即为新客） */
  async isNewCustomer(storeId: number, phone: string): Promise<boolean> {
    const existing = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, phone, deletedAt: null },
      select: { id: true },
    });
    return existing === null;
  }

  /** 充值到账：校验档位 → 叠加额度 → 写流水 */
  async recharge(
    storeId: number,
    amountFen: number,
  ): Promise<NewCustomerQuotaOverview> {
    const isAllowedTier = RECHARGE_TIER_AMOUNT_FEN.some(
      (tier) => tier === amountFen,
    );
    if (!isAllowedTier) {
      throw new ForbiddenException('充值档位不合法');
    }

    const quotaCount = calcQuotaByAmountFen(amountFen);
    const orderId = `QUOTA${storeId}${Date.now()}`;

    await this.prisma.$transaction(
      async (tx) => {
        await tx.storeMembershipProfile.upsert({
          where: { storeId },
          create: { storeId },
          update: {},
        });

        const updated = await tx.storeMembershipProfile.update({
          where: { storeId },
          data: { newCustomerQuota: { increment: quotaCount } },
          select: { newCustomerQuota: true },
        });

        await tx.storeNewCustomerQuotaLog.create({
          data: {
            storeId,
            type: 'recharge',
            changeAmount: quotaCount,
            balanceAfter: updated.newCustomerQuota,
            amountFen,
            orderId,
            description: `微信支付充值 ${formatAmountFenToYuanDisplay(amountFen)}`,
          },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return this.getOverview(storeId);
  }

  /** 会员赠送：购买 / 续费成功时一次性叠加，免费档位不赠送 */
  async grantByPlan(
    storeId: number,
    planId: string | null | undefined,
  ): Promise<number> {
    const quotaCount = resolvePlanGrant(planId);
    if (quotaCount <= 0) return 0;

    await this.prisma.$transaction(
      async (tx) => {
        await tx.storeMembershipProfile.upsert({
          where: { storeId },
          create: { storeId },
          update: {},
        });

        const updated = await tx.storeMembershipProfile.update({
          where: { storeId },
          data: { newCustomerQuota: { increment: quotaCount } },
          select: { newCustomerQuota: true },
        });

        await tx.storeNewCustomerQuotaLog.create({
          data: {
            storeId,
            type: 'grant',
            changeAmount: quotaCount,
            balanceAfter: updated.newCustomerQuota,
            description: `${resolvePlanGrantLabel(planId)}赠送`,
          },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return quotaCount;
  }

  /** 额度清零：设置为免费会员 / 注销账号时调用 */
  async clear(storeId: number, description: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const profile = await tx.storeMembershipProfile.findUnique({
          where: { storeId },
          select: { newCustomerQuota: true },
        });

        const remaining = profile?.newCustomerQuota ?? 0;
        if (remaining <= 0) return;

        await tx.storeMembershipProfile.update({
          where: { storeId },
          data: { newCustomerQuota: 0 },
        });

        await tx.storeNewCustomerQuotaLog.create({
          data: {
            storeId,
            type: 'clear',
            changeAmount: -remaining,
            balanceAfter: 0,
            description,
          },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }

  /**
   * 新客消耗额度：同一手机号在同一门店只扣一次。
   * 额度不足时抛 NEW_CUSTOMER_QUOTA_EXHAUSTED（事务回滚，不产生消耗记录）。
   */
  async consumeForNewCustomer(
    storeId: number,
    phone: string,
  ): Promise<ConsumeNewCustomerQuotaResult> {
    return this.prisma.$transaction(
      async (tx) => {
        try {
          await tx.storeNewCustomerQuotaConsume.create({
            data: { storeId, phone },
          });
        } catch (error) {
          if (
            error instanceof Prisma.PrismaClientKnownRequestError &&
            error.code === 'P2002'
          ) {
            // 该手机号在本店已扣过：老顾客重复绑定不重复扣减
            const existing = await tx.storeMembershipProfile.findUnique({
              where: { storeId },
              select: { newCustomerQuota: true },
            });
            return {
              consumed: false,
              remaining: existing?.newCustomerQuota ?? 0,
            };
          }
          throw error;
        }

        const updated = await tx.storeMembershipProfile.updateMany({
          where: { storeId, newCustomerQuota: { gt: 0 } },
          data: {
            newCustomerQuota: { decrement: 1 },
            newCustomerQuotaConsumed: { increment: 1 },
          },
        });

        if (updated.count === 0) {
          throw new ForbiddenException({
            message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
            code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
          });
        }

        const profile = await tx.storeMembershipProfile.findUnique({
          where: { storeId },
          select: { newCustomerQuota: true },
        });
        const remaining = profile?.newCustomerQuota ?? 0;

        await tx.storeNewCustomerQuotaLog.create({
          data: {
            storeId,
            type: 'consume',
            changeAmount: -1,
            balanceAfter: remaining,
            description: '新客授权手机号消耗',
          },
        });

        return { consumed: true, remaining };
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }
}
