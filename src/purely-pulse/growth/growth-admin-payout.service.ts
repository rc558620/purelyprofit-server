import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import {
  assertWithdrawalTransition,
  buildWithdrawalAuditLog,
  buildWithdrawalTransitionData,
  updateWithdrawalStatusOrThrow,
} from '../../purely-profit/member/withdrawals/withdrawals.state-machine';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import type {
  PulseAdminApprovePayoutDto,
  PulseAdminRejectPayoutDto,
} from './dto/pulse-growth-admin.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import { queryAdminPayoutActionRecord } from './growth-admin-payout.query';

@Injectable()
export class PulseGrowthAdminPayoutService {
  private readonly logger = new Logger(PulseGrowthAdminPayoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly accessService: PulseGrowthAccessService,
  ) {}

  async approveAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminApprovePayoutDto,
  ): Promise<{ success: true }> {
    void dto;
    const record = await queryAdminPayoutActionRecord(this.prisma, payoutId);

    if (!record) {
      throw new NotFoundException('打款申请不存在');
    }

    await this.accessService.assertCanAccessAdminStore(
      user,
      record.storeId,
      '打款申请不存在',
    );

    // 与商家端共用同一状态机：pulse 的「确认打款」等价于 pay 动作
    const rule = assertWithdrawalTransition('pay', record.status);
    const staffId = user.currentMembership?.staffId ?? null;
    const data = buildWithdrawalTransitionData({
      action: 'pay',
      now: new Date(),
      staffId,
    });

    await this.prisma.$transaction(
      async (tx) => {
        await updateWithdrawalStatusOrThrow(tx, {
          withdrawalId: payoutId,
          storeId: record.storeId,
          from: rule.from,
          data,
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      buildWithdrawalAuditLog({
        action: 'pay',
        withdrawalId: payoutId,
        storeId: record.storeId,
        from: record.status,
        staffId,
      }),
    );
    await this.invalidatePayoutDerivedCaches(record.storeId);

    return { success: true };
  }

  async rejectAdminPayout(
    user: AuthenticatedUser,
    payoutId: number,
    dto: PulseAdminRejectPayoutDto,
  ): Promise<{ success: true }> {
    const record = await queryAdminPayoutActionRecord(this.prisma, payoutId);

    if (!record) {
      throw new NotFoundException('打款申请不存在');
    }

    await this.accessService.assertCanAccessAdminStore(
      user,
      record.storeId,
      '打款申请不存在',
    );

    const rule = assertWithdrawalTransition('reject', record.status);
    const staffId = user.currentMembership?.staffId ?? null;
    const data = buildWithdrawalTransitionData({
      action: 'reject',
      now: new Date(),
      staffId,
      rejectReason: dto.rejectReason.trim(),
    });

    await this.prisma.$transaction(
      async (tx) => {
        await updateWithdrawalStatusOrThrow(tx, {
          withdrawalId: payoutId,
          storeId: record.storeId,
          from: rule.from,
          data,
        });

        const partnerUpdateResult = await tx.storePartner.updateMany({
          where: {
            id: record.partnerId,
            storeId: record.storeId,
            totalWithdrawnBeans: { gte: record.beanAmount },
          },
          data: {
            beanBalance: { increment: record.beanAmount },
            totalWithdrawnBeans: { decrement: record.beanAmount },
          },
        });

        if (partnerUpdateResult.count !== 1) {
          throw new ConflictException('合伙人余额更新失败，请稍后重试');
        }

        await tx.storePartnerBeanLog.create({
          data: {
            storeId: record.storeId,
            partnerId: record.partnerId,
            source: 'admin_adjust',
            changeAmount: record.beanAmount,
            description: `打款驳回退回 · ${record.beanAmount} 豆已退回`,
          },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      buildWithdrawalAuditLog({
        action: 'reject',
        withdrawalId: payoutId,
        storeId: record.storeId,
        from: record.status,
        staffId,
      }),
    );
    await this.invalidatePayoutDerivedCaches(record.storeId);

    return { success: true };
  }

  private async invalidatePayoutDerivedCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidatePulseGrowthAdminQueries(),
      this.cacheInvalidatorService.invalidatePulseGrowthEarnings(storeId),
      this.cacheInvalidatorService.invalidatePulseDashboardHome(),
      this.cacheInvalidatorService.invalidatePulseDashboardRevenueDetail(),
      this.cacheInvalidatorService.invalidatePulseDashboardOverview(storeId),
      this.cacheInvalidatorService.invalidatePulseSessionNotification(storeId),
      this.cacheInvalidatorService.invalidatePulseSessionBootstrap(storeId),
      this.cacheInvalidatorService.invalidatePulseOnboardingStatus(storeId),
      // 打款/驳回会改动 partner_withdrawals 与合伙人豆余额，
      // 商家端提现列表、汇总、豆子中心与合伙人资料共用同一份数据，必须一并失效。
      this.cacheInvalidatorService.invalidateWithdrawalsDerived(storeId),
      this.cacheInvalidatorService.invalidatePlatformMembershipDerived(storeId),
      this.cacheInvalidatorService.invalidateDashboardAndPulseSession(storeId),
    ]);
  }
}
