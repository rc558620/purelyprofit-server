import { ConflictException, Injectable } from '@nestjs/common';
import { PartnerWithdrawalStatus, Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildWithdrawalsListCacheKey,
  buildWithdrawalsOverviewCacheKey,
} from '../../../redis/keys';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import {
  type ApplyWithdrawalDto,
  type ListWithdrawalsQueryDto,
} from './dto/apply-withdrawal.dto';
import { RejectWithdrawalDto } from './dto/review-withdrawal.dto';
import {
  type ApplyWithdrawalResponseDto,
  type ReviewWithdrawalResponseDto,
  type WithdrawalOverviewResponseDto,
  type WithdrawalRecordResponseDto,
} from './dto/withdrawal-response.dto';
import {
  mapWithdrawalRecord,
  withdrawalRecordSelect,
  type WithdrawalRecordSnapshot,
} from './withdrawals.mapper';
import {
  WithdrawalsSharedService,
  calcWithdrawalAmounts,
} from './withdrawals-shared.service';

type PrismaTransactionExecutor = Prisma.TransactionClient;

type WithdrawalStatusUpdateInput = {
  withdrawalId: number;
  storeId: number;
  currentStatus: PartnerWithdrawalStatus;
  nextStatus: PartnerWithdrawalStatus;
  reviewedAt?: Date | null;
  paidAt?: Date | null;
  rejectReason?: string | null;
};

type ApplyWithdrawalTransactionInput = {
  storeId: number;
  partnerId: number;
  operatorStaffId: number | null;
  dto: ApplyWithdrawalDto;
  accountNo: string;
  accountName: string;
};

const WITHDRAWALS_OVERVIEW_CACHE_TTL_SECONDS = 90;
const WITHDRAWALS_OVERVIEW_REFRESH_AFTER_MS = 20_000;
const WITHDRAWALS_LIST_CACHE_TTL_SECONDS = 45;
const WITHDRAWALS_LIST_REFRESH_AFTER_MS = 15_000;
const APPLY_DUPLICATE_WINDOW_MS = 5_000;

@Injectable()
export class WithdrawalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly withdrawalsSharedService: WithdrawalsSharedService,
  ) {}

  async getOverview(
    user: AuthenticatedUser,
  ): Promise<WithdrawalOverviewResponseDto> {
    const storeId =
      this.withdrawalsSharedService.getCurrentStoreIdOrThrow(user);
    const cacheKey = buildWithdrawalsOverviewCacheKey(storeId);

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: WITHDRAWALS_OVERVIEW_CACHE_TTL_SECONDS,
      refreshAfterMs: WITHDRAWALS_OVERVIEW_REFRESH_AFTER_MS,
      loadValue: () =>
        this.withdrawalsSharedService.buildOverview(this.prisma, storeId),
    });
  }

  async list(
    user: AuthenticatedUser,
    query: ListWithdrawalsQueryDto,
  ): Promise<WithdrawalRecordResponseDto[]> {
    const storeId =
      this.withdrawalsSharedService.getCurrentStoreIdOrThrow(user);
    const cacheKey = buildWithdrawalsListCacheKey(storeId, {
      status: query.status,
    });

    return this.refreshableCache.getOrLoadRefreshableJson({
      cacheKey,
      taskKey: buildCacheRefreshTaskKey(cacheKey),
      ttlSeconds: WITHDRAWALS_LIST_CACHE_TTL_SECONDS,
      refreshAfterMs: WITHDRAWALS_LIST_REFRESH_AFTER_MS,
      loadValue: async () => {
        const records = await this.prisma.partnerWithdrawal.findMany({
          where: {
            storeId,
            ...(query.status ? { status: query.status } : {}),
          },
          select: withdrawalRecordSelect,
          orderBy: [{ appliedAt: 'desc' }, { id: 'desc' }],
        });

        return records.map((record) => mapWithdrawalRecord(record));
      },
    });
  }

  async preview(
    user: AuthenticatedUser,
    beanAmount: number,
  ): Promise<{ beanAmount: number; rmbAmount: number; netRmbAmount: number }> {
    const storeId =
      this.withdrawalsSharedService.getCurrentStoreIdOrThrow(user);
    this.withdrawalsSharedService.ensureWithdrawAmountWithinFrontEndRange(
      beanAmount,
    );

    const partner =
      await this.withdrawalsSharedService.findApprovedPartnerForApplyOrThrow(
        storeId,
      );
    if (partner.beanBalance < beanAmount) {
      throw new ConflictException('纯利豆余额不足');
    }

    return calcWithdrawalAmounts(beanAmount);
  }

  async apply(
    user: AuthenticatedUser,
    dto: ApplyWithdrawalDto,
  ): Promise<ApplyWithdrawalResponseDto> {
    const storeId =
      this.withdrawalsSharedService.getCurrentStoreIdOrThrow(user);
    this.withdrawalsSharedService.ensureWithdrawAmountWithinFrontEndRange(
      dto.beanAmount,
    );

    const partner =
      await this.withdrawalsSharedService.findApprovedPartnerForApplyOrThrow(
        storeId,
        dto.partnerId,
      );
    if (partner.beanBalance < dto.beanAmount) {
      throw new ConflictException('纯利豆余额不足，无法发起提现申请');
    }

    // 防重复提交：短时间窗口内同合伙人同金额的处理中申请视为重复提交，直接拒绝。
    // 配合事务内余额乐观锁，杜绝快速连点/弱网重试生成多条提现记录。
    const recentDuplicate = await this.prisma.partnerWithdrawal.findFirst({
      where: {
        storeId,
        partnerId: partner.id,
        beanAmount: dto.beanAmount,
        status: {
          in: [
            PartnerWithdrawalStatus.pending,
            PartnerWithdrawalStatus.approved,
          ],
        },
        appliedAt: { gte: new Date(Date.now() - APPLY_DUPLICATE_WINDOW_MS) },
      },
      orderBy: { appliedAt: 'desc' },
      select: { id: true },
    });
    if (recentDuplicate) {
      throw new ConflictException('请勿重复提交提现申请');
    }

    const account = this.withdrawalsSharedService.normalizeAccountInfoOrThrow(
      dto.accountNo,
      dto.accountName,
    );

    const response = await this.prisma.$transaction(async (tx) => {
      const createdRecord = await this.createWithdrawalApplication(tx, {
        storeId,
        partnerId: partner.id,
        operatorStaffId: user.currentMembership?.staffId ?? null,
        dto,
        accountNo: account.accountNo,
        accountName: account.accountName,
      });

      return this.withdrawalsSharedService.buildOperationResponse(
        tx,
        storeId,
        createdRecord,
      );
    });

    await this.invalidateDashboardCaches(storeId);

    return response;
  }

  async approve(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record =
      await this.withdrawalsSharedService.getScopedWithdrawalOrThrow(
        user,
        withdrawalId,
      );
    this.assertWithdrawalStatus(
      record.status,
      PartnerWithdrawalStatus.pending,
      '仅审核中的提现申请可执行通过操作',
    );

    const response = await this.prisma.$transaction(async (tx) => {
      await this.updateWithdrawalStatusOrThrow(tx, {
        withdrawalId,
        storeId: record.storeId,
        currentStatus: PartnerWithdrawalStatus.pending,
        nextStatus: PartnerWithdrawalStatus.approved,
        reviewedAt: new Date(),
        rejectReason: null,
      });

      return this.buildReviewResponse(tx, record.storeId, withdrawalId);
    });

    await this.invalidateDashboardCaches(record.storeId);

    return response;
  }

  async reject(
    user: AuthenticatedUser,
    withdrawalId: number,
    dto: RejectWithdrawalDto,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record =
      await this.withdrawalsSharedService.getScopedWithdrawalOrThrow(
        user,
        withdrawalId,
      );
    this.assertWithdrawalStatus(
      record.status,
      PartnerWithdrawalStatus.pending,
      '仅审核中的提现申请可执行拒绝操作',
    );

    const rejectReason = dto.reason.trim();
    if (rejectReason === '') {
      throw new ConflictException('拒绝原因不能为空');
    }

    const response = await this.prisma.$transaction(async (tx) => {
      await this.updateWithdrawalStatusOrThrow(tx, {
        withdrawalId,
        storeId: record.storeId,
        currentStatus: PartnerWithdrawalStatus.pending,
        nextStatus: PartnerWithdrawalStatus.rejected,
        reviewedAt: new Date(),
        rejectReason,
      });
      await this.refundRejectedWithdrawalOrThrow(tx, record);

      return this.buildReviewResponse(tx, record.storeId, withdrawalId);
    });

    await this.invalidateDashboardCaches(record.storeId);

    return response;
  }

  async pay(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record =
      await this.withdrawalsSharedService.getScopedWithdrawalOrThrow(
        user,
        withdrawalId,
      );
    this.assertWithdrawalStatus(
      record.status,
      PartnerWithdrawalStatus.approved,
      '仅已通过审核的提现申请可确认打款',
    );

    const response = await this.prisma.$transaction(async (tx) => {
      await this.updateWithdrawalStatusOrThrow(tx, {
        withdrawalId,
        storeId: record.storeId,
        currentStatus: PartnerWithdrawalStatus.approved,
        nextStatus: PartnerWithdrawalStatus.paid,
        paidAt: new Date(),
      });

      return this.buildReviewResponse(tx, record.storeId, withdrawalId);
    });

    await this.invalidateDashboardCaches(record.storeId);

    return response;
  }

  private async createWithdrawalApplication(
    tx: PrismaTransactionExecutor,
    input: ApplyWithdrawalTransactionInput,
  ): Promise<WithdrawalRecordSnapshot> {
    const { storeId, partnerId, operatorStaffId, dto, accountNo, accountName } =
      input;
    const partnerUpdateResult = await tx.storePartner.updateMany({
      where: {
        id: partnerId,
        status: 'approved',
        beanBalance: { gte: dto.beanAmount },
      },
      data: {
        beanBalance: { decrement: dto.beanAmount },
        totalWithdrawnBeans: { increment: dto.beanAmount },
        paymentAccountType: dto.accountType,
        paymentAccountNo: accountNo,
        paymentAccountName: accountName,
      },
    });

    if (partnerUpdateResult.count !== 1) {
      throw new ConflictException('纯利豆余额不足，无法发起提现申请');
    }

    const createdRecord = await tx.partnerWithdrawal.create({
      data: {
        storeId,
        partnerId,
        operatorStaffId,
        beanAmount: dto.beanAmount,
        rmbAmount: calcWithdrawalAmounts(dto.beanAmount).rmbAmount,
        accountType: dto.accountType,
        accountNo,
        accountName,
        status: PartnerWithdrawalStatus.pending,
      },
      select: withdrawalRecordSelect,
    });

    await tx.storePartnerBeanLog.create({
      data: {
        storeId,
        partnerId,
        source: 'withdrawal',
        changeAmount: -dto.beanAmount,
        description: `提现申请 · ${dto.beanAmount} 豆`,
      },
    });

    return createdRecord;
  }

  private async updateWithdrawalStatusOrThrow(
    tx: PrismaTransactionExecutor,
    input: WithdrawalStatusUpdateInput,
  ): Promise<void> {
    const { withdrawalId, storeId, currentStatus, nextStatus } = input;
    const updateResult = await tx.partnerWithdrawal.updateMany({
      where: {
        id: withdrawalId,
        storeId,
        status: currentStatus,
      },
      data: {
        status: nextStatus,
        ...(input.reviewedAt !== undefined
          ? { reviewedAt: input.reviewedAt }
          : {}),
        ...(input.paidAt !== undefined ? { paidAt: input.paidAt } : {}),
        ...(input.rejectReason !== undefined
          ? { rejectReason: input.rejectReason }
          : {}),
      },
    });

    if (updateResult.count !== 1) {
      throw new ConflictException('提现申请状态已变化，请刷新后重试');
    }
  }

  private async refundRejectedWithdrawalOrThrow(
    tx: PrismaTransactionExecutor,
    record: WithdrawalRecordSnapshot,
  ): Promise<void> {
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
        description: `提现退回 · ${record.beanAmount} 豆已退回`,
      },
    });
  }

  private assertWithdrawalStatus(
    actualStatus: PartnerWithdrawalStatus,
    expectedStatus: PartnerWithdrawalStatus,
    errorMessage: string,
  ): void {
    if (actualStatus !== expectedStatus) {
      throw new ConflictException(errorMessage);
    }
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateDashboardAndPulseSession(storeId),
      this.cacheInvalidatorService.invalidateWithdrawalsDerived(storeId),
      this.cacheInvalidatorService.invalidatePulseGrowthEarnings(storeId),
    ]);
  }

  private async buildReviewResponse(
    tx: PrismaTransactionExecutor,
    storeId: number,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record =
      await this.withdrawalsSharedService.findWithdrawalByIdOrThrow(
        tx,
        withdrawalId,
      );

    return this.withdrawalsSharedService.buildOperationResponse(
      tx,
      storeId,
      record,
    ) as Promise<ReviewWithdrawalResponseDto>;
  }
}
