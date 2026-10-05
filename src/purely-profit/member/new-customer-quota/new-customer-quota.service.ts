// 新用户额度服务：余额查询 / 充值 / 会员赠送 / 清零 / 新客消耗（扣减幂等 + 防超卖）
import { ForbiddenException, Injectable } from '@nestjs/common';
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
import type { PrismaExecutor } from '../platform-membership/platform-membership.types';
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

  /**
   * 该顾客在本店是否属于新客（尚未消耗过额度即为新客）。
   *
   * 判定以 **C 端账号 ID** 为准，刻意不看 `marketingCustomer` 档案：
   * 扫码进桌即建档（占位手机号 `club_wechat:{openid}`），绑定手机号后该档案
   * 被迁移成真实号码，按手机号判定会把首单新客误判成老客，额度永不消耗。
   */
  async isNewCustomer(storeId: number, clubUserId: number): Promise<boolean> {
    const existing = await this.prisma.storeNewCustomerQuotaConsume.findUnique({
      where: {
        storeId_clubUserId: { storeId, clubUserId },
      },
      select: { id: true },
    });
    return existing === null;
  }

  /**
   * 新客下单前的额度闸门。
   *
   * - 老客（本店已消耗过额度）→ 直接放行；
   * - 新客且额度已用完 → 抛 NEW_CUSTOMER_QUOTA_EXHAUSTED，阻止建单；
   * - 新客且额度充足 → 放行，随后由调用方在建单成功后扣减。
   *
   * @returns true 表示「按新客放行」，false 表示「老客放行」
   */
  async ensureAvailableForNewCustomer(
    storeId: number,
    clubUserId: number,
  ): Promise<boolean> {
    const isNew = await this.isNewCustomer(storeId, clubUserId);
    if (!isNew) return false;

    if (!(await this.hasRemaining(storeId))) {
      throw new ForbiddenException({
        message: NEW_CUSTOMER_QUOTA_EXHAUSTED_MESSAGE,
        code: NEW_CUSTOMER_QUOTA_EXHAUSTED_CODE,
      });
    }
    return true;
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

  /**
   * 运营增减额度：按增量调整余额（不会低于 0），并写一条流水。
   *
   * 供 purelyPulse「新客额度」管理页使用：平台运营代商家发放 / 回收额度。
   * 与 `recharge`（微信支付充值）、`grantByPlan`（会员赠送）共用同一张流水表，
   * 保证 purelyProfit 额度页的「余额 + 累计赠送 + 流水」三者始终自洽。
   *
   * 流水类型受枚举限制（recharge / grant / consume / clear）：增加按 `grant` 记，
   * 减少按 `clear` 记；余额未发生变化时（例如已是 0 仍继续减少）不写流水，
   * 避免产生 0 变动的噪音记录。
   *
   * @returns 调整后的余额
   */
  async adjustQuota(
    storeId: number,
    delta: number,
    description: string,
  ): Promise<number> {
    const safeDelta = Math.trunc(Number.isFinite(delta) ? delta : 0);

    return this.prisma.$transaction(
      async (tx) => {
        await tx.storeMembershipProfile.upsert({
          where: { storeId },
          create: { storeId },
          update: {},
        });

        const profile = await tx.storeMembershipProfile.findUnique({
          where: { storeId },
          select: { newCustomerQuota: true },
        });
        const remaining = profile?.newCustomerQuota ?? 0;
        const nextQuota = Math.max(0, remaining + safeDelta);
        const changeAmount = nextQuota - remaining;
        if (changeAmount === 0) return nextQuota;

        await tx.storeMembershipProfile.update({
          where: { storeId },
          data: { newCustomerQuota: nextQuota },
        });

        await tx.storeNewCustomerQuotaLog.create({
          data: {
            storeId,
            type: changeAmount > 0 ? 'grant' : 'clear',
            changeAmount,
            balanceAfter: nextQuota,
            description,
          },
        });

        return nextQuota;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );
  }

  /**
   * 会员赠送：购买 / 续费成功时一次性叠加，免费档位不赠送。
   *
   * multiplier 为购买期数（管理端「追加期数」：年度 × 2 = 300 × 2 = 600）。
   * 未传或非法值（非正整数）按 1 期处理，老调用方（支付成功赠送）不受影响。
   *
   * `executor` 用于把赠送并入调用方的事务：额度是 **increment 叠加**，
   * 与外层写档案的操作不在同一事务里时，中途失败重试会重复赠送。
   */
  async grantByPlan(
    storeId: number,
    planId: string | null | undefined,
    multiplier = 1,
    executor: PrismaExecutor = this.prisma,
  ): Promise<number> {
    const baseQuota = resolvePlanGrant(planId);
    if (baseQuota <= 0) return 0;

    const periodCount =
      Number.isInteger(multiplier) && (multiplier as number) > 0
        ? multiplier
        : 1;
    const quotaCount = baseQuota * periodCount;

    const writeGrant = async (tx: PrismaExecutor): Promise<void> => {
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
          description: `${resolvePlanGrantLabel(planId)}赠送${
            periodCount > 1 ? ` ×${periodCount}` : ''
          }`,
        },
      });
    };

    // 已经在事务里就直接复用连接，事务客户端没有 $transaction 可嵌套
    if (executor === this.prisma) {
      await this.prisma.$transaction(writeGrant, {
        timeout: TX_TIMEOUT_MEDIUM,
      });
    } else {
      await writeGrant(executor);
    }

    return quotaCount;
  }

  /**
   * 额度清零：设置为免费会员 / 注销账号时调用。
   *
   * `executor` 用于并入调用方事务——在已持有 `storeMembershipProfile` 行锁的
   * 事务里再开一个独立事务会互相等待，必须复用同一连接。
   */
  async clear(
    storeId: number,
    description: string,
    executor: PrismaExecutor = this.prisma,
  ): Promise<void> {
    const writeClear = async (tx: PrismaExecutor): Promise<void> => {
      {
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
      }
    };

    if (executor === this.prisma) {
      await this.prisma.$transaction(writeClear, {
        timeout: TX_TIMEOUT_MEDIUM,
      });
    } else {
      await writeClear(executor);
    }
  }

  /**
   * 新客消耗额度：同一顾客（clubUserId）在同一门店只扣一次。
   * 额度不足时抛 NEW_CUSTOMER_QUOTA_EXHAUSTED（事务回滚，不产生消耗记录）。
   *
   * `executor` 用于把扣减并入**建单事务**：闸门只是乐观预检，真正的一致性由
   * 「订单落库 + 扣减」在同一事务内提交来保证——扣不到额度就必须让建单一起回滚，
   * 否则并发下第二个新客会白嫖一个额度（订单成立但额度没扣）。
   *
   * 并发正确性靠两点，不需要额外的锁表：
   * - `updateMany` 的 `newCustomerQuota: { gt: 0 }` 条件 + PostgreSQL 行锁：
   *   两个新客争抢最后一个额度时，先到者把额度扣到 0 并提交，后到者的 UPDATE
   *   在锁释放后重新评估 WHERE（READ COMMITTED），条件不再满足 → count=0 → 抛错；
   * - `storeNewCustomerQuotaConsume` 的唯一约束保证同一顾客不会被重复记账。
   *
   * ⚠️ 老客必须在写入之前用查询识别出来，不能靠「insert 撞唯一约束再兜」：
   * PostgreSQL 下事务内一旦触发 P2002，整个事务进入 aborted 状态、后续语句全部
   * 失败，会把老客的整笔建单一起拖垮。
   *
   * @param phone 可选的手机号快照，仅用于运营追溯；未绑手机号即下单时传 null
   */
  async consumeForNewCustomer(
    storeId: number,
    clubUserId: number,
    phone?: string | null,
    executor: PrismaExecutor = this.prisma,
  ): Promise<ConsumeNewCustomerQuotaResult> {
    const consume = async (
      tx: PrismaExecutor,
    ): Promise<ConsumeNewCustomerQuotaResult> => {
      // 老客（本店已消耗过额度）：直接放行，不做任何写入
      const existing = await tx.storeNewCustomerQuotaConsume.findUnique({
        where: { storeId_clubUserId: { storeId, clubUserId } },
        select: { id: true },
      });
      if (existing) {
        const profile = await tx.storeMembershipProfile.findUnique({
          where: { storeId },
          select: { newCustomerQuota: true },
        });
        return { consumed: false, remaining: profile?.newCustomerQuota ?? 0 };
      }

      // 新客：抢占 1 个额度（额度为 0 时命中 0 行 → 抛错回滚）
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

      await tx.storeNewCustomerQuotaConsume.create({
        data: { storeId, clubUserId, phone: phone ?? null },
      });

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
          // 消耗点不再只有「授权手机号」：下单（扫码点餐 / 自助下单 / 团购券 /
          // 服务商品）同样扣减，且这些链路并不强制绑定手机号，
          // 写成「授权手机号消耗」会让商家在流水里看到与事实不符的描述。
          description: '新客消耗',
        },
      });

      return { consumed: true, remaining };
    };

    // 已经在事务里就直接复用连接，事务客户端没有 $transaction 可嵌套
    if (executor === this.prisma) {
      return this.prisma.$transaction(consume, {
        timeout: TX_TIMEOUT_MEDIUM,
      });
    }
    return consume(executor);
  }
}
