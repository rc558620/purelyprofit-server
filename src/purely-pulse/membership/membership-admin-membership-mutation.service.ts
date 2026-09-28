import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { resolveStoredMembershipLevel } from '../../purely-profit/member/platform-membership/platform-membership-access.shared';
import { resolveEffectivePlanId } from '../../purely-profit/member/platform-membership/membership-plan-resolver';
import { isSubAccountPricingPlan } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { PrismaExecutor } from '../../purely-profit/member/platform-membership/platform-membership.types';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import {
  resolveAmountFen,
  resolvePriceFen,
} from './membership-admin-money.utils';
import { DAY_MS, MAX_MEMBERSHIP_PERIOD_COUNT } from './membership.constants';
import type {
  PulseAdminMemberLevel,
  PulseAdminMembershipMutationInput,
  PulseAdminMembershipProfileRecord,
  PulseMembershipPlanId,
} from './membership.types';

@Injectable()
export class PulseMembershipAdminMembershipMutationService {
  private readonly logger = new Logger(
    PulseMembershipAdminMembershipMutationService.name,
  );

  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
    private readonly mutationStateService: PulseMembershipAdminMutationStateService,
    private readonly quotaService: NewCustomerQuotaService,
    private readonly storeSubAccountService: StoreSubAccountService,
  ) {}

  /**
   * 落盘管理员设置的会员档位：解析目标档位 → 校验降级确认 → 写 profile
   * → 失效派生缓存 → 写入成交价快照。
   *
   * 档位遵循「**只升不降**」：所选档位低于当前档位时，默认**保持原档位不变**，
   * 只按所选档位追加时长（等价于给客户赠送时长）。这是为了避开一个死局——
   * 开了子账号的门店一旦被降到月度，续费页会因 `resolveVisibleRenewalPlanIds`
   * 只下发年度卡，而按月度下单又会被 `assertRenewalPlanAllowed` 用 409 拒绝，
   * 客户就成了「既升不上去、也续不了当期」。
   *
   * 确实要降档时，调用方必须显式传 `confirmDowngradePlan`。
   *
   * 只负责「档案怎么写」，鉴权与详情重建由上层编排服务负责。
   */
  async applyAdminMembershipLevel(
    user: AuthenticatedUser,
    memberId: number,
    dto: PulseAdminMembershipMutationInput,
  ): Promise<void> {
    const targetLevel = this.resolveAdminMemberLevel(dto);
    const targetPlanId = this.toMembershipPlanId(targetLevel);
    const current =
      await this.mutationStateService.loadAdminMemberStateOrThrow(memberId);
    this.assertFreeDowngradeConfirmed(current.profile, dto, targetLevel);
    // 时长按**所选档位**折算（年度会员选「月度 × 2」就是加 60 天），
    // 但落地档位要过「只升不降」，两者相互独立
    const nextExpiry = await this.resolveAdminMembershipExpiry(
      dto,
      targetLevel,
    );
    const nextPlanId = this.resolveWritablePlanId({
      profile: current.profile,
      targetPlanId,
      dto,
    });
    const nextPreviousPlanId = this.resolveNextPreviousPlanId({
      profile: current.profile,
      nextPlanId,
    });
    const now = new Date();

    // 追加多期时复核时长：时长由前端算好传入，额度却按 multiplier 叠加，
    // 两者一旦脱钩，直调接口可以「multiplier: 12 + 1 天」白拿 12 期新客额度
    if (nextExpiry !== null && targetPlanId !== null) {
      const currentExpiry = current.profile.expiresAt;
      await this.assertMultiPeriodExpiry({
        planId: targetPlanId,
        periodCount: this.resolveQuotaPeriodCount(targetLevel, dto.multiplier),
        // 与前端同一口径：仍在有效期内就从原到期时间起算，否则从当下起算
        baseAt:
          currentExpiry && currentExpiry.getTime() > now.getTime()
            ? currentExpiry
            : now,
        expiresAt: nextExpiry,
      });
    }

    this.logMembershipLevelMutation({
      user,
      memberId,
      previousPlanId: current.profile.currentPlanId,
      previousExpiresAt: current.profile.expiresAt,
      nextLevel: targetLevel,
      nextPlanId,
      nextExpiry,
      dto,
    });

    // 档案、额度、成交价快照必须同生共死。
    //
    // 额度是 **increment 叠加**：分三次写库时，任何一步失败都会留下「档位已改、
    // 接口 500」的半成品，运营看到报错后重试 → 额度再叠一次，白送几百位新客。
    // 三步放进同一事务后，失败即整体回滚，重试是安全的。
    const membershipProfile = await this.prisma.$transaction(
      async (tx) => {
        const profile = await tx.storeMembershipProfile.upsert({
          where: { storeId: memberId },
          create: {
            storeId: memberId,
            currentPlanId: nextPlanId,
            // 降级为免费时转存原档位：currentPlanId 被清空后，续费页只能靠它
            // 判断「原本买的是哪一档」，否则永久会员会丢掉 AGES 续费入口
            previousPlanId: nextPreviousPlanId,
            // startsAt 始终落盘：即使降级为免费也保留，表示档案已被显式管理，
            // 避免 /center 的订单重建逻辑（normalizeMembershipProfileFromPaidOrders）
            // 把「管理员设置的免费」误判为「档案缺失」而用历史付费订单恢复会员
            startsAt: now,
            expiresAt: nextExpiry,
            totalPoints: current.profile.totalPoints,
            availablePoints: current.profile.availablePoints,
          },
          update: {
            currentPlanId: nextPlanId,
            previousPlanId: nextPreviousPlanId,
            startsAt: now,
            expiresAt: nextExpiry,
          },
        });

        // 新用户额度：设置档位即按档位赠送（叠加）；降级为免费会员则清零。
        // ① 按**所选档位** targetPlanId 发放，与确认弹窗展示的「新用户额度 N 位新客」一致；
        //    不能用 nextPlanId——「只升不降」把档位抬回原档时（如永久会员选月度、未确认降档），
        //    nextPlanId 仍是永久，会按 300 位发放，而弹窗承诺的是月度的 50 位。
        // ② 按**期数**叠加：与追加时长同一口径，年度 × 2 加 730 天就该送 300 × 2 = 600 位。
        if (targetLevel === 'free') {
          // 清零是幂等的（写死 0），放在事务外也不会重复扣，但留在事务内
          // 才能保证「档位回滚时额度也回滚」
          await this.quotaService.clear(
            memberId,
            '设置为免费会员，新用户额度清零',
            tx,
          );
        } else {
          await this.quotaService.grantByPlan(
            memberId,
            targetPlanId,
            this.resolveQuotaPeriodCount(targetLevel, dto.multiplier),
            tx,
          );
        }

        // 只在**真正落到所选档位**时记录成交价。若被「只升不降」抬回原档位，
        // 说明这是一次赠送时长而非成交，运营填的临时金额不该污染长期成交价。
        const isPlanActuallyChanged = nextPlanId === targetPlanId;
        if (isPlanActuallyChanged) {
          await this.upsertDealPrice({
            storeId: memberId,
            nextPlanId: targetPlanId,
            priceDisplay: dto.priceDisplay,
            subAccountCount: dto.subAccountCount,
            subAccountAmountDisplay: dto.subAccountAmountDisplay,
            executor: tx,
          });
        }

        return profile;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

    // 运营在弹窗里填了子账号数量 = 明确要给这个客户开通子账号能力（幂等写，放事务外安全）：
    // 必须同步设置配额，否则商家端没有可分配的子账号槽位，
    // 「续费价 498」与「实际能用子账号」就会脱节。填 0 / 不填不动配额，
    // 避免误关已有能力（关能力走子账号配额弹窗）
    if (
      targetPlanId !== null &&
      isSubAccountPricingPlan(targetPlanId) &&
      (dto.subAccountCount ?? 0) > 0
    ) {
      await this.storeSubAccountService.updateQuota(
        memberId,
        dto.subAccountCount as number,
        user.id,
        '设置会员等级时同步开通子账号',
      );
    }

    // 落一条会员订单，用于：①「是否计入收入」开关 → 是否算平台营收；
    // ② 会员详情页「设置会员等级记录」模块的数据来源。
    // 降级为免费不是充值，不落单
    if (nextPlanId !== null && targetLevel !== 'free') {
      // 订单一律按**所选档位**（targetPlanId）记账，「计入收入」不再受档位是否被抬回影响。
      //
      // 被「只升不降」抬回高档位时，档案仍是原档位、只是按所选档位追加时长，
      // 但运营手上收到的就是所选档位的钱（永久会员选月度 = 收了一笔月卡的钱），
      // 因此这笔账同样可以计入营收，金额取所选档位的成交价 / 配置价。
      //
      // 若按 nextPlanId（被抬回的高档位）计，会变成「加 30 天却记成卖了一套
      // 永久会员、营收 +398」——多出来的钱运营根本没收到。
      const countAsIncome = dto.countAsIncome === true;

      // 落单失败不得回滚已完成的档位变更：档案、额度、子账号都已写库，
      // 抛出去只会让运营看到「设置失败」从而重试，反而重复改档、重复落单。
      // 记录缺失可以事后补，档位被重复改写不行。
      try {
        await this.recordAdminMembershipOrder({
          user,
          memberId,
          profileId: membershipProfile.id,
          planId: targetPlanId,
          priceDisplay: dto.priceDisplay,
          countAsIncome,
          now,
        });
      } catch (error) {
        this.logger.error(
          JSON.stringify({
            event: 'pulse_admin_membership_order_record_failed',
            memberId,
            operatorUserId: user.id,
            operatorEmail: user.email,
            planId: targetPlanId,
            countAsIncome: dto.countAsIncome === true,
            message: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    }
  }

  /**
   * 管理端设置会员等级 → 写一条会员订单。
   *
   * - 勾选「计入收入」：渠道 admin，金额取成交价，算作平台营收；
   *   未填成交价（月度 / 季度档位不要求填价）时回落到**所选档位**的配置价，
   *   避免落一笔 ¥0 却计入营收、虚增成交笔数
   * - 未勾选（赠送）：渠道 gift，金额落 0。营收统计已排除 gift，
   *   因此既不增加营收也不虚增成交笔数，但记录里仍留痕并标注「赠送」。
   *
   * 订单的 planId 取**所选档位**而非最终落盘档位：永久会员选月度但不降档时，
   * 收的是月卡的钱，营收就该是月卡的钱。
   *
   * 没有微信支付单号，paymentOrderId 留空（该列可空且唯一约束允许多个 NULL）。
   */
  private async recordAdminMembershipOrder(params: {
    user: AuthenticatedUser;
    memberId: number;
    profileId: number;
    planId: PulseAdminMembershipProfileRecord['currentPlanId'];
    priceDisplay?: string;
    countAsIncome: boolean;
    now: Date;
  }): Promise<void> {
    const {
      user,
      memberId,
      profileId,
      planId,
      priceDisplay,
      countAsIncome,
      now,
    } = params;

    if (planId === null) {
      return;
    }

    const plan = await this.platformMembershipService.getPlanConfig(planId);
    // 只有**没填**成交价时才回落到**档位配置价**。
    //
    // 月度 / 季度档位在弹窗里不要求填价（只有年度 / 永久才填），此时落 0 会让
    // 营收统计「成交笔数 +1、营收金额 +0」——既虚增笔数，记录里又是一笔 ¥0，
    // 而会员实际拿到的是有价套餐。配置价是这笔收入最接近的真实口径。
    //
    // ⚠️ 反过来，填了却解析不出金额（如 '0' / 非法串）**绝不回落配置价**：
    // 运营填 0 就是没收钱，回落会凭空记一笔全价营收。这里与 DTO 的正数校验互为双保险。
    const hasPriceInput =
      typeof priceDisplay === 'string' && priceDisplay.trim() !== '';
    const requestedAmount = hasPriceInput
      ? resolvePriceFen(priceDisplay)
      : plan.price;
    // 算不出来钱（填了 0、配置价为 0 等异常）却仍勾了「计入收入」：退回赠送处理。
    // 0 元落一笔 paid/admin 只会虚增成交笔数、营收一分没涨，对账时是纯噪音
    const isIncome =
      countAsIncome && requestedAmount !== null && requestedAmount > 0;
    const amount = isIncome ? (requestedAmount as number) : 0;

    await this.prisma.storeMembershipOrder.create({
      data: {
        storeId: memberId,
        profileId,
        planId,
        planName: plan.name,
        originalAmount: amount,
        amount,
        status: 'paid',
        paymentChannel: isIncome ? 'admin' : 'gift',
        paidAt: now,
      },
    });

    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_membership_order_recorded',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        planId,
        amount,
        paymentChannel: isIncome ? 'admin' : 'gift',
        countAsIncome,
        /** 勾了「计入收入」但系统算不出金额，被按赠送处理 */
        forcedGift: countAsIncome && !isIncome,
      }),
    );
  }

  /**
   * 决定最终写入 `currentPlanId` 的档位，实现「只升不降」。
   *
   * - 当前会员**仍在有效期内**时，按 `PLAN_LEVEL_RANK` 取较高档位；
   *   想落回到更低的档位必须带 `confirmDowngradePlan`
   * - 当前会员**已到期 / 本身就是免费**时，没有「降」可言，直接采用目标档位
   *   （与商家端自助购买口径一致：`resolveEffectivePlanId(null, planId)`）
   */
  resolveWritablePlanId(params: {
    profile: PulseAdminMembershipProfileRecord;
    targetPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
    dto: PulseAdminMembershipMutationInput;
  }): PulseAdminMembershipProfileRecord['currentPlanId'] {
    const { profile, targetPlanId, dto } = params;

    if (targetPlanId === null) {
      return null;
    }

    const isCurrentlyActive =
      profile.currentPlanId !== null &&
      profile.expiresAt !== null &&
      profile.expiresAt.getTime() > Date.now();

    if (!isCurrentlyActive) {
      return targetPlanId;
    }

    const keptPlanId = resolveEffectivePlanId(
      profile.currentPlanId,
      targetPlanId,
    );

    return keptPlanId === targetPlanId || dto.confirmDowngradePlan === true
      ? targetPlanId
      : keptPlanId;
  }

  /**
   * 新客额度的赠送期数：与追加时长同一口径，一期 = 一个完整档位周期。
   *
   * - 永久会员没有「期」的概念（弹窗也不给期数选项），固定 1 期
   * - 免费会员走清零分支，同样固定 1 期（值不会用到）
   * - 不传 / 非正整数 / 超过弹窗可选上限（12）一律按 1 期，避免异常值放大赠送
   */
  resolveQuotaPeriodCount(
    targetLevel: PulseAdminMemberLevel,
    multiplier: number | undefined,
  ): number {
    if (targetLevel === 'lifetime' || targetLevel === 'free') return 1;
    if (
      !Number.isInteger(multiplier) ||
      (multiplier as number) < 1 ||
      (multiplier as number) > MAX_MEMBERSHIP_PERIOD_COUNT
    ) {
      return 1;
    }
    return multiplier as number;
  }

  /** 重置门店的首购锁定价，让运营可以在下一次成交时重新锁价。返回清除条数。 */
  async resetAdminMemberLockedPrices(
    user: AuthenticatedUser,
    memberId: number,
  ): Promise<number> {
    const clearedCount =
      await this.lockedPriceService.resetLockedPrices(memberId);
    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_membership_locked_price_reset',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        clearedCount,
      }),
    );

    await this.mutationStateService.invalidateAdminMemberDerived(memberId);

    return clearedCount;
  }

  private logMembershipLevelMutation(params: {
    user: AuthenticatedUser;
    memberId: number;
    previousPlanId: PulseMembershipPlanId | null;
    previousExpiresAt: Date | null;
    nextLevel: PulseAdminMemberLevel;
    nextPlanId: PulseMembershipPlanId | null;
    nextExpiry: Date | null;
    dto: PulseAdminMembershipMutationInput;
  }): void {
    const {
      user,
      memberId,
      previousPlanId,
      previousExpiresAt,
      nextLevel,
      nextPlanId,
      nextExpiry,
      dto,
    } = params;

    this.logger.warn(
      JSON.stringify({
        event: 'pulse_admin_membership_level_mutation',
        memberId,
        operatorUserId: user.id,
        operatorEmail: user.email,
        previousPlanId,
        previousExpiresAt: previousExpiresAt?.toISOString() ?? null,
        nextLevel,
        nextPlanId,
        nextExpiry: nextExpiry?.toISOString() ?? null,
        confirmDowngradeToFree: dto.confirmDowngradeToFree ?? false,
        actionSource: dto.actionSource ?? 'unknown',
        requestId: dto.auditContext?.requestId ?? null,
        ip: dto.auditContext?.ip ?? null,
        userAgent: dto.auditContext?.userAgent ?? null,
      }),
    );
  }

  /**
   * 成交价快照：管理端「设置会员等级」是一次显式成交，必须**覆盖**旧价，
   * 否则运营改了价却查不到效果。商家端自助购买仍保持首充锁定语义。
   */
  private async upsertDealPrice(params: {
    storeId: number;
    nextPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
    priceDisplay?: string;
    subAccountCount?: number;
    subAccountAmountDisplay?: string;
    executor?: PrismaExecutor;
  }): Promise<void> {
    const {
      storeId,
      nextPlanId: planId,
      priceDisplay,
      subAccountCount,
      subAccountAmountDisplay,
      executor,
    } = params;
    const price = resolvePriceFen(priceDisplay);
    const subAccountAmount = resolveAmountFen(subAccountAmountDisplay);

    if (!planId || price === null) {
      return;
    }

    // 子账号分量只对年 / 永久档位有意义：月 / 季开不了子账号，
    // 即便请求里带了这两个字段也不得写入，避免污染快照
    const subAccountAllowed = isSubAccountPricingPlan(planId);

    await this.lockedPriceService.upsertDealPrice({
      storeId,
      planId,
      price,
      source: 'admin',
      ...(executor ? { executor } : {}),
      // 未录入的字段保持原值，不要把 NULL 写回去
      ...(subAccountAllowed && subAccountAmount !== null
        ? { subAccountAmount }
        : {}),
      // 数量 0 不写库：与「填了数量才同步开通配额」（updateQuota 只在 > 0 时调用）
      // 保持同一语义。写 0 会让续费卡显示「包含 0 个子账号」，而门店的实时配额
      // 并没被清掉——收了子账号的钱却说一个都没有
      ...(subAccountAllowed &&
      subAccountCount !== undefined &&
      subAccountCount > 0
        ? { subAccountCount }
        : {}),
    });
  }

  resolveAdminMemberLevel(
    dto: PulseAdminMembershipMutationInput,
  ): PulseAdminMemberLevel {
    const nextLevel = dto.level ?? dto.memberLevel ?? dto.membershipLevel;
    if (!nextLevel) {
      throw new BadRequestException('缺少会员等级');
    }

    return nextLevel;
  }

  assertFreeDowngradeConfirmed(
    profile: PulseAdminMembershipProfileRecord,
    dto: PulseAdminMembershipMutationInput,
    nextLevel: PulseAdminMemberLevel,
  ): void {
    if (nextLevel !== 'free') {
      return;
    }

    const isCurrentlyActive =
      profile.currentPlanId !== null &&
      profile.expiresAt !== null &&
      profile.expiresAt.getTime() > Date.now();

    if (!isCurrentlyActive) {
      return;
    }

    if (dto.confirmDowngradeToFree === true) {
      return;
    }

    throw new BadRequestException(
      '当前会员仍在有效期内，降级到免费会员需要显式确认',
    );
  }

  async resolveAdminMembershipExpiry(
    dto: PulseAdminMembershipMutationInput,
    nextLevel: PulseAdminMemberLevel,
  ): Promise<Date | null> {
    const rawExpiry = dto.membershipExpiry ?? dto.expireAt ?? dto.expiryAt;
    if (rawExpiry !== null && rawExpiry !== undefined) {
      const explicitExpiry = new Date(rawExpiry);
      if (Number.isNaN(explicitExpiry.getTime())) {
        throw new BadRequestException('会员到期时间不合法');
      }
      return explicitExpiry;
    }

    if (nextLevel === 'free') {
      return null;
    }

    if (nextLevel === 'lifetime') {
      const lifetimePlan =
        await this.platformMembershipService.getPlanConfig('lifetime');
      if (lifetimePlan.validDays !== null && lifetimePlan.validDays > 0) {
        return new Date(Date.now() + lifetimePlan.validDays * DAY_MS);
      }
      return null;
    }

    throw new BadRequestException('缺少会员到期时间');
  }

  /**
   * 复核「追加多期」的到期时间：服务端不能只信前端算好的 expiry。
   *
   * 新客额度按 multiplier 叠加，时长却完全由调用方传入——两者脱钩时，
   * 直调接口可以 `multiplier: 12` 配 1 天时长，只送 1 天会员却拿走 12 期额度。
   * 因此多期请求必须满足 `到期时间 = 起算点 + 单期天数 × 期数`。
   *
   * 单期请求（`periodCount <= 1`）不校验：老调用方（补偿 / 迁移）会传任意到期时间，
   * 收紧它们会误伤既有流程，而单期本身没有放大赠送的空间。
   */
  private async assertMultiPeriodExpiry(params: {
    planId: PulseMembershipPlanId;
    periodCount: number;
    /** 起算点：仍在有效期内为原到期时间，否则为当下 */
    baseAt: Date;
    expiresAt: Date;
  }): Promise<void> {
    const { planId, periodCount, baseAt, expiresAt } = params;
    if (periodCount <= 1) {
      return;
    }

    const plan = await this.platformMembershipService.getPlanConfig(planId);
    // 年度 / 永久用自然日 validDays，月 / 季回落到 durationMonths × 30
    const singlePeriodDays = plan.validDays ?? (plan.durationMonths ?? 0) * 30;
    if (singlePeriodDays <= 0) {
      return;
    }

    const expectedMs = singlePeriodDays * periodCount * DAY_MS;
    const actualMs = expiresAt.getTime() - baseAt.getTime();
    // 容忍前后端时钟差与「整月按 30 天」的口径差异，超出即视为参数不自洽
    const toleranceMs = 2 * DAY_MS;

    if (Math.abs(actualMs - expectedMs) > toleranceMs) {
      throw new BadRequestException(
        `追加 ${periodCount} 期的到期时间与套餐周期不符：应为 ${singlePeriodDays * periodCount} 天`,
      );
    }
  }

  toMembershipPlanId(
    level: PulseAdminMemberLevel,
  ): PulseAdminMembershipProfileRecord['currentPlanId'] {
    switch (level) {
      case 'monthly':
        return 'monthly';
      case 'quarterly':
        return 'quarterly';
      case 'annual':
        return 'yearly';
      case 'lifetime':
        return 'lifetime';
      default:
        return null;
    }
  }

  /**
   * 解析降级到免费时需要转存的「原档位」`previousPlanId`。
   *
   * 设为免费会清空 `currentPlanId`，续费页由此无法判断「原本买的是哪一档」
   * （`resolveStoredMembershipLevel` 回落成 'free'），曾开通子账号功能的门店
   * 会被错判成年度档、丢掉 AGES(永久) 的续费入口，所以降级时必须先把原档位转存下来。
   *
   * 重新设置付费档位时返回 `null`：此时 `currentPlanId` 本身就是续费依据。
   *
   * 取 `resolveStoredMembershipLevel` 的结果（忽略到期判定），因此
   * 「已到期的年度会员」降级后原档位仍是年度，与续费保护的既有口径一致；
   * 历史永久会员（`yearly` + 无到期时间）也会被正确识别成 lifetime。
   */
  resolveNextPreviousPlanId(params: {
    profile: PulseAdminMembershipProfileRecord;
    nextPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
  }): PulseAdminMembershipProfileRecord['currentPlanId'] {
    if (params.nextPlanId !== null) {
      return null;
    }

    const storedLevel = resolveStoredMembershipLevel({
      currentPlanId: params.profile.currentPlanId,
      previousPlanId: params.profile.previousPlanId ?? null,
      startsAt: params.profile.startsAt ?? null,
      expiresAt: params.profile.expiresAt,
    });

    return storedLevel === 'free' ? null : storedLevel;
  }
}
