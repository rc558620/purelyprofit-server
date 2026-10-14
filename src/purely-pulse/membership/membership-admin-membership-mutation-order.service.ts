import { Injectable, Logger } from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PlatformMembershipService } from '../../purely-profit/member/platform-membership/platform-membership.service';
import { StoreMembershipLockedPriceService } from '../../purely-profit/member/platform-membership/store-membership-locked-price.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { PrismaExecutor } from '../../purely-profit/member/platform-membership/platform-membership.types';
import {
  buildDealPriceSnapshot,
  buildMembershipOrderRecordedAuditEvent,
  resolveAdminMembershipOrderAmount,
} from './membership-admin-membership-mutation.utils';
import type { PulseAdminMembershipProfileRecord } from './membership.types';

/**
 * 管理端「设置会员等级」的写侧副作用：落会员订单、写成交价快照。
 *
 * 单独抽离是因为这两件事都依赖 `prisma` / `lockedPriceService` /
 * `platformMembershipService`，且不与「只升不降」「多期时长复核」等纯决策逻辑耦合；
 * 主服务编排完档位决策后，把落地动作委托给本服务。
 * （档位变更的审计日志 `pulse_admin_membership_level_mutation` 归属主服务。）
 *
 * 注意：`upsertDealPrice` 接收事务执行器 `executor`，必须与被改写的 `profile` 同事务，
 * 否则档案回滚时成交价快照不会回滚。
 */
@Injectable()
export class PulseMembershipAdminMembershipMutationOrderService {
  private readonly logger = new Logger(
    PulseMembershipAdminMembershipMutationOrderService.name,
  );

  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
    private readonly prisma: PrismaService,
    private readonly lockedPriceService: StoreMembershipLockedPriceService,
  ) {}

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
  async recordAdminMembershipOrder(params: {
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
    // 金额 / 渠道口径（含「0 元回落配置价 vs 退回赠送」护栏）见
    // `resolveAdminMembershipOrderAmount`：勾选计入收入取成交价、否则按赠送落 0。
    const { amount, paymentChannel, forcedGift } =
      resolveAdminMembershipOrderAmount({
        planPrice: plan.price,
        priceDisplay,
        countAsIncome,
      });

    await this.prisma.storeMembershipOrder.create({
      data: {
        storeId: memberId,
        profileId,
        planId,
        planName: plan.name,
        originalAmount: amount,
        amount,
        status: 'paid',
        paymentChannel,
        paidAt: now,
      },
    });

    this.logger.warn(
      JSON.stringify(
        buildMembershipOrderRecordedAuditEvent({
          memberId,
          operatorUserId: user.id,
          operatorEmail: user.email,
          planId,
          amount,
          paymentChannel,
          countAsIncome,
          forcedGift,
        }),
      ),
    );
  }

  /**
   * 成交价快照：管理端「设置会员等级」是一次显式成交，必须**覆盖**旧价，
   * 否则运营改了价却查不到效果。商家端自助购买仍保持首充锁定语义。
   *
   * 仅当真正落到所选档位（调用方判断 `nextPlanId === targetPlanId`）时才调用本方法，
   * 被「只升不降」抬回原档位时是赠送时长而非成交，不得污染长期成交价。
   */
  async upsertDealPrice(params: {
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

    // 降级为免费（planId 为空）不落成交价快照
    if (!planId) {
      return;
    }

    // 价格解析不出（缺失 / 非法）时不落成交价快照；子账号分量的写入口径
    // （仅年 / 永久档位、数量 0 不写）见 `buildDealPriceSnapshot`
    const snapshot = buildDealPriceSnapshot({
      planId,
      priceDisplay,
      subAccountCount,
      subAccountAmountDisplay,
    });
    if (!snapshot) {
      return;
    }

    await this.lockedPriceService.upsertDealPrice({
      storeId,
      planId,
      price: snapshot.price,
      source: 'admin',
      ...(executor ? { executor } : {}),
      ...(snapshot.subAccountAmount !== undefined
        ? { subAccountAmount: snapshot.subAccountAmount }
        : {}),
      ...(snapshot.subAccountCount !== undefined
        ? { subAccountCount: snapshot.subAccountCount }
        : {}),
    });
  }
}
