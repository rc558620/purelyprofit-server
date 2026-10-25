// 新用户额度服务：余额查询 / 充值 / 会员赠送 / 清零 / 新客消耗（扣减幂等 + 防超卖）
//
// 分层：入参校验、文案组装与 HTTP 语义在本文件；数据库读写在 .query.ts / .write.ts；
// 纯计算（档位换算、期数与增量归一化、展示格式化）在 .domain.ts。
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import type { PrismaExecutor } from '../platform-membership/platform-membership.types';
import {
  DEFAULT_QUOTA_LOG_LIMIT,
  NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
  RECHARGE_TIER_AMOUNT_FEN,
} from './new-customer-quota.constants';
import {
  calcQuotaByAmountFen,
  formatAmountFenToYuanDisplay,
  normalizePeriodCount,
  normalizeQuotaDelta,
  resolvePlanGrant,
} from './new-customer-quota.domain';
import {
  findRemainingQuota,
  hasConsumeRecord,
  listQuotaLogs,
  readQuotaTotals,
} from './new-customer-quota.query';
import { buildQuotaExhaustedException } from './new-customer-quota.shared';
import type {
  ConsumeNewCustomerQuotaResult,
  NewCustomerQuotaLogItem,
  NewCustomerQuotaOverview,
  NewCustomerQuotaTier,
} from './new-customer-quota.types';
import {
  adjustQuotaWithinTx,
  runQuotaWrite,
  writeClear,
  writeConsume,
  writeGrant,
} from './new-customer-quota.write';

@Injectable()
export class NewCustomerQuotaService {
  constructor(private readonly prisma: PrismaService) {}

  /** 额度概览：余额 + 累计充值/赠送/已服务新客 */
  async getOverview(storeId: number): Promise<NewCustomerQuotaOverview> {
    const totals = await readQuotaTotals(this.prisma, storeId);

    return {
      storeId,
      warningThreshold: NEW_CUSTOMER_QUOTA_WARNING_THRESHOLD,
      ...totals,
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
    limit: number = DEFAULT_QUOTA_LOG_LIMIT,
  ): Promise<NewCustomerQuotaLogItem[]> {
    return listQuotaLogs(this.prisma, storeId, limit);
  }

  /** 剩余额度是否大于 0（用于 C 端绑定前预检） */
  async hasRemaining(storeId: number): Promise<boolean> {
    return (await findRemainingQuota(this.prisma, storeId)) > 0;
  }

  /**
   * 该顾客是否属于新客：**全局口径**（任意门店都没有其消耗记录即为新客）。
   *
   * 刻意不是「本店新客」。额度的计量对象是「手机号认证」（微信 getPhoneNumber，
   * 0.03 元/次），而一位顾客的手机号**一生只需认证一次**：在 A 店认证过之后，
   * 换到 B / C / D 店都不该再要求验证一次手机号，自然也不该再扣一次额度。
   * 额度记在「第一家服务该顾客的门店」头上，之后所有门店共享这个认证结果。
   *
   * 判定以 **C 端账号 ID** 为准，刻意不看 `marketingCustomer` 档案：
   * 扫码进桌即建档（占位手机号 `club_wechat:{openid}`），绑定手机号后该档案
   * 被迁移成真实号码，按手机号判定会把首单新客误判成老客，额度永不消耗。
   */
  async isNewCustomer(clubUserId: number): Promise<boolean> {
    return !(await hasConsumeRecord(this.prisma, clubUserId));
  }

  /**
   * 下单前的额度闸门。
   *
   * - 老客（已在任意门店消耗过额度）→ 直接放行；
   * - 新客且本店额度已用完 → 抛 NEW_CUSTOMER_QUOTA_EXHAUSTED，阻止建单；
   * - 新客且本店额度充足 → 放行，随后由调用方在建单成功后扣减。
   *
   * 本店额度为 0 仍拦新客：这位顾客的第一次服务发生在当前门店，
   * 为其认证手机号的成本就该由当前门店承担。
   *
   * @returns true 表示「按新客放行」，false 表示「老客放行」
   */
  async ensureAvailableForNewCustomer(
    storeId: number,
    clubUserId: number,
  ): Promise<boolean> {
    if (!(await this.isNewCustomer(clubUserId))) return false;

    if (!(await this.hasRemaining(storeId))) {
      throw buildQuotaExhaustedException();
    }
    return true;
  }

  /**
   * 运营增减额度：按增量调整余额（不会低于 0），并写一条流水。
   *
   * 供 purelyPulse「新客额度」管理页使用：平台运营代商家发放 / 回收额度。
   * 与 `NewCustomerQuotaRechargeService`（微信支付充值）、`grantByPlan`（会员赠送）共用同一张流水表，
   * 保证 purelyProfit 额度页的「余额 + 累计赠送 + 流水」三者始终自洽。
   *
   * 一律记 `admin_adjust`（平台运营调整），不再借 `grant` / `clear` 表达：
   * 借用会让商家端「累计会员赠送」把运营发放的量也算进去，与页面宣称的
   * 「月50 / 季100 / 年300」对不上。
   *
   * @returns 调整后的余额
   */
  async adjustQuota(
    storeId: number,
    delta: number,
    description: string,
  ): Promise<number> {
    return this.runWrite((tx) =>
      adjustQuotaWithinTx(tx, {
        storeId,
        delta: normalizeQuotaDelta(delta),
        description,
      }),
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

    const periodCount = normalizePeriodCount(multiplier);
    const quotaCount = baseQuota * periodCount;

    await runQuotaWrite(this.prisma, executor, (tx) =>
      writeGrant(tx, {
        storeId,
        planId: planId ?? null,
        quotaCount,
        periodCount,
      }),
    );

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
    await runQuotaWrite(this.prisma, executor, (tx) =>
      writeClear(tx, { storeId, description }),
    );
  }

  /**
   * 额度消耗：同一顾客（clubUserId）**全局只扣一次**。
   * 额度不足时抛 NEW_CUSTOMER_QUOTA_EXHAUSTED（事务回滚，不产生消耗记录）。
   *
   * `executor` 用于把扣减并入**建单事务**：闸门只是乐观预检，真正的一致性由
   * 「订单落库 + 扣减」在同一事务内提交来保证——扣不到额度就必须让建单一起回滚，
   * 否则并发下第二个新客会白嫖一个额度（订单成立但额度没扣）。
   *
   * @param phone 可选的手机号快照，仅用于运营追溯；未绑手机号即下单时传 null
   */
  async consumeForNewCustomer(
    storeId: number,
    clubUserId: number,
    phone?: string | null,
    executor: PrismaExecutor = this.prisma,
  ): Promise<ConsumeNewCustomerQuotaResult> {
    return runQuotaWrite(this.prisma, executor, (tx) =>
      writeConsume(tx, { storeId, clubUserId, phone: phone ?? null }),
    );
  }

  /** 无外部事务可复用（充值 / 运营调额）时，开一个独立事务执行写操作 */
  private runWrite<T>(write: (tx: PrismaExecutor) => Promise<T>): Promise<T> {
    return runQuotaWrite(this.prisma, this.prisma, write);
  }
}
