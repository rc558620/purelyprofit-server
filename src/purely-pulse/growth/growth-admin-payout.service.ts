import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PartnerWithdrawalStatus } from '@prisma/client';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import type {
  PulseAdminApprovePayoutDto,
  PulseAdminRejectPayoutDto,
} from './dto/pulse-growth-admin.dto';
import { PulseGrowthAccessService } from './growth-access.service';
import { queryAdminPayoutActionRecord } from './growth-admin.query';

@Injectable()
export class PulseGrowthAdminPayoutService {
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

    if (
      record.status !== PartnerWithdrawalStatus.pending &&
      record.status !== PartnerWithdrawalStatus.approved
    ) {
      throw new ConflictException('当前打款申请状态不可执行确认打款');
    }

    const now = new Date();
    const updateResult = await this.prisma.partnerWithdrawal.updateMany({
      where: {
        id: payoutId,
        storeId: record.storeId,
        status: {
          in: [
            PartnerWithdrawalStatus.pending,
            PartnerWithdrawalStatus.approved,
          ],
        },
      },
      data: {
        status: PartnerWithdrawalStatus.paid,
        reviewedAt: now,
        paidAt: now,
        rejectReason: null,
      },
    });

    if (updateResult.count !== 1) {
      throw new ConflictException('打款申请状态已变化，请刷新后重试');
    }

    await this.cacheInvalidatorService.invalidatePulseGrowthAdminQueries();

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

    if (
      record.status !== PartnerWithdrawalStatus.pending &&
      record.status !== PartnerWithdrawalStatus.approved
    ) {
      throw new ConflictException('当前打款申请状态不可执行拒绝操作');
    }

    const rejectReason = dto.rejectReason.trim();
    if (!rejectReason) {
      throw new ConflictException('拒绝原因不能为空');
    }

    await this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const updateResult = await tx.partnerWithdrawal.updateMany({
        where: {
          id: payoutId,
          storeId: record.storeId,
          status: {
            in: [
              PartnerWithdrawalStatus.pending,
              PartnerWithdrawalStatus.approved,
            ],
          },
        },
        data: {
          status: PartnerWithdrawalStatus.rejected,
          reviewedAt: now,
          paidAt: null,
          rejectReason,
        },
      });

      if (updateResult.count !== 1) {
        throw new ConflictException('打款申请状态已变化，请刷新后重试');
      }

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
    });

    await this.cacheInvalidatorService.invalidatePulseGrowthAdminQueries();

    return { success: true };
  }
}
