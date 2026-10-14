import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { isSubAccountPricingPlan } from '../../purely-profit/member/platform-membership/platform-membership.constants';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { NewCustomerQuotaService } from '../../purely-profit/member/new-customer-quota/new-customer-quota.service';
import { StoreSubAccountService } from '../../purely-profit/member/platform-membership/store-sub-account.service';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { PulseMembershipAdminMutationStateService } from './membership-admin-mutation-state.service';
import { PulseMembershipAdminMembershipMutationOrderService } from './membership-admin-membership-mutation-order.service';
import {
  assertFreeDowngradeConfirmed,
  assertMultiPeriodExpiry,
  buildMembershipLevelMutationAuditEvent,
  resolveAdminMemberLevel,
  resolveAdminMembershipExpiry,
  resolveNextPreviousPlanId,
  resolveQuotaPeriodCount,
  resolveWritablePlanId as resolveWritablePlanIdPure,
  toMembershipPlanId,
} from './membership-admin-membership-mutation.utils';
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
    private readonly orderService: PulseMembershipAdminMembershipMutationOrderService,
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
    const targetLevel = resolveAdminMemberLevel(dto);
    const targetPlanId = toMembershipPlanId(targetLevel);
    const current =
      await this.mutationStateService.loadAdminMemberStateOrThrow(memberId);
    assertFreeDowngradeConfirmed(current.profile, dto, targetLevel);
    // 时长按**所选档位**折算（年度会员选「月度 × 2」就是加 60 天），
    // 但落地档位要过「只升不降」，两者相互独立
    const getPlanConfig = this.platformMembershipService.getPlanConfig.bind(
      this.platformMembershipService,
    );
    const nextExpiry = await resolveAdminMembershipExpiry(
      dto,
      targetLevel,
      getPlanConfig,
    );
    const nextPlanId = resolveWritablePlanIdPure({
      profile: current.profile,
      targetPlanId,
      dto,
    });
    const nextPreviousPlanId = resolveNextPreviousPlanId({
      profile: current.profile,
      nextPlanId,
    });
    const now = new Date();

    // 追加多期时复核时长：时长由前端算好传入，额度却按 multiplier 叠加，
    // 两者一旦脱钩，直调接口可以「multiplier: 12 + 1 天」白拿 12 期新客额度
    if (nextExpiry !== null && targetPlanId !== null) {
      const currentExpiry = current.profile.expiresAt;
      await assertMultiPeriodExpiry(
        {
          planId: targetPlanId,
          periodCount: resolveQuotaPeriodCount(targetLevel, dto.multiplier),
          // 与前端同一口径：仍在有效期内就从原到期时间起算，否则从当下起算
          baseAt:
            currentExpiry && currentExpiry.getTime() > now.getTime()
              ? currentExpiry
              : now,
          expiresAt: nextExpiry,
        },
        getPlanConfig,
      );
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
            resolveQuotaPeriodCount(targetLevel, dto.multiplier),
            tx,
          );
        }

        // 只在**真正落到所选档位**时记录成交价。若被「只升不降」抬回原档位，
        // 说明这是一次赠送时长而非成交，运营填的临时金额不该污染长期成交价。
        const isPlanActuallyChanged = nextPlanId === targetPlanId;
        if (isPlanActuallyChanged) {
          await this.orderService.upsertDealPrice({
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
        await this.orderService.recordAdminMembershipOrder({
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
   * 决定最终写入 `currentPlanId` 的档位，实现「只升不降」。
   *
   * 纯逻辑见 `resolveWritablePlanId`（`.utils`），本方法只是服务对外的兼容入口，
   * 便于测试与上层直接调用。
   */
  resolveWritablePlanId(params: {
    profile: PulseAdminMembershipProfileRecord;
    targetPlanId: PulseAdminMembershipProfileRecord['currentPlanId'];
    dto: PulseAdminMembershipMutationInput;
  }): PulseAdminMembershipProfileRecord['currentPlanId'] {
    return resolveWritablePlanIdPure(params);
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

  /**
   * 记「设置会员等级」审计日志（落盘前调用，纯序列化 + 输出）。
   *
   * 归属主服务而非写侧子服务：它是本次档位变更操作的审计，与落单 / 成交价快照
   * 分属不同关注点，日志上下文也应指向编排服务本身。
   */
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
      JSON.stringify(
        buildMembershipLevelMutationAuditEvent({
          memberId,
          operatorUserId: user.id,
          operatorEmail: user.email,
          previousPlanId,
          previousExpiresAt,
          nextLevel,
          nextPlanId,
          nextExpiry,
          confirmDowngradeToFree: dto.confirmDowngradeToFree ?? false,
          actionSource: dto.actionSource ?? 'unknown',
          requestId: dto.auditContext?.requestId ?? null,
          ip: dto.auditContext?.ip ?? null,
          userAgent: dto.auditContext?.userAgent ?? null,
        }),
      ),
    );
  }
}
