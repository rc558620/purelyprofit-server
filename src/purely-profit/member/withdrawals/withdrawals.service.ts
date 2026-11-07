import {
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import {
  buildCacheRefreshTaskKey,
  buildWithdrawalsListCacheKey,
} from '../../../redis/keys';
import { CacheInvalidatorService } from '../../../redis/invalidator';
import { RefreshableCacheService } from '../../../redis/refreshable-cache.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
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
import {
  assertWithdrawalTransition,
  buildWithdrawalAuditLog,
  buildWithdrawalTransitionData,
  updateWithdrawalStatusOrThrow,
  type WithdrawalAction,
} from './withdrawals.state-machine';
import {
  type PrismaTransactionExecutor,
  WITHDRAWALS_LIST_CACHE_TTL_SECONDS,
  WITHDRAWALS_LIST_REFRESH_AFTER_MS,
  APPLY_LOCK_TTL_SECONDS,
  APPLY_LOCK_RETRY_TIMES,
  APPLY_LOCK_RETRY_DELAY_MS,
  APPLY_IDEMPOTENCY_KEY_MAX_LENGTH,
  findIdempotentWithdrawal,
  createWithdrawalApplication,
  refundRejectedWithdrawalOrThrow,
} from './withdrawals.utils';

@Injectable()
export class WithdrawalsService {
  private readonly logger = new Logger(WithdrawalsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly refreshableCache: RefreshableCacheService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly withdrawalsSharedService: WithdrawalsSharedService,
    private readonly redisLockService: RedisLockService,
  ) {}

  /**
   * 提现汇总包含 beanBalance / totalWithdrawnBeans 等资金读数，必须强一致。
   *
   * RefreshableCacheService 明确要求「需要强一致的读数（余额、库存）不要走这里」：
   * loadValue 与写回之间若发生提现，旧余额会被写回并存活一个 TTL，
   * 会出现提交/审核后余额回退，影响二次提现判断与对账。
   */
  async getOverview(
    user: AuthenticatedUser,
  ): Promise<WithdrawalOverviewResponseDto> {
    const storeId =
      this.withdrawalsSharedService.getCurrentStoreIdOrThrow(user);
    return this.withdrawalsSharedService.buildOverview(this.prisma, storeId);
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
    rawIdempotencyKey?: string,
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

    const account = this.withdrawalsSharedService.normalizeAccountInfo(
      dto.accountNo,
      dto.accountName,
    );
    const idempotencyKey = this.resolveIdempotencyKey(rawIdempotencyKey);

    try {
      // 资金写入串行化：同门店同合伙人的申请共用一把短锁；
      // 锁内完成幂等重放 / 扣豆 / 建单，唯一索引作为跨实例最终兜底。
      return await this.withApplyLock(storeId, partner.id, async () =>
        this.prisma.$transaction(
          async (tx) => {
            const existing = await findIdempotentWithdrawal(tx, {
              storeId,
              idempotencyKey,
            });
            if (existing) {
              this.assertSameApplication(existing, {
                partnerId: partner.id,
                beanAmount: dto.beanAmount,
              });
              return this.withdrawalsSharedService.buildOperationResponse(
                tx,
                storeId,
                existing,
              );
            }

            const createdRecord = await createWithdrawalApplication(tx, {
              storeId,
              partnerId: partner.id,
              operatorStaffId: user.currentMembership?.staffId ?? null,
              idempotencyKey,
              dto,
              accountNo: account.accountNo,
              accountName: account.accountName,
            });

            return this.withdrawalsSharedService.buildOperationResponse(
              tx,
              storeId,
              createdRecord,
            );
          },
          { timeout: TX_TIMEOUT_MEDIUM },
        ),
      );
    } catch (error) {
      // 唯一约束被并发请求命中：不产生第二笔扣豆，按幂等语义返回先落库的记录
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const existing = await this.prisma.partnerWithdrawal.findFirst({
          where: { storeId, idempotencyKey },
          select: withdrawalRecordSelect,
        });
        if (existing) {
          return this.withdrawalsSharedService.buildOperationResponse(
            this.prisma,
            storeId,
            existing,
          );
        }
      }
      throw error;
    }
  }

  private resolveIdempotencyKey(rawKey?: string): string {
    const trimmed = rawKey?.trim();
    if (trimmed && trimmed.length <= APPLY_IDEMPOTENCY_KEY_MAX_LENGTH) {
      return trimmed;
    }
    // 老客户端未携带幂等键：服务端生成，保证同额合法二次申请也不会被误拒
    return `srv-${randomUUID()}`;
  }

  private assertSameApplication(
    existing: WithdrawalRecordSnapshot,
    input: { partnerId: number; beanAmount: number },
  ): void {
    if (
      existing.partnerId !== input.partnerId ||
      existing.beanAmount !== input.beanAmount
    ) {
      throw new ConflictException('幂等键已被其它提现申请使用，请重试');
    }
  }

  private async withApplyLock<T>(
    storeId: number,
    partnerId: number,
    operation: () => Promise<T>,
  ): Promise<T> {
    const lock = await this.redisLockService.acquireLock(
      `withdrawals:apply:store:${storeId}:partner:${partnerId}`,
      {
        ttlSeconds: APPLY_LOCK_TTL_SECONDS,
        retryTimes: APPLY_LOCK_RETRY_TIMES,
        retryDelayMs: APPLY_LOCK_RETRY_DELAY_MS,
      },
    );

    if (!lock) {
      throw new ConflictException('提现申请正在处理中，请稍后重试');
    }

    try {
      const result = await operation();
      await this.invalidateDashboardCaches(storeId);
      return result;
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }

  async approve(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.runReviewAction(user, withdrawalId, 'approve');
  }

  async reject(
    user: AuthenticatedUser,
    withdrawalId: number,
    dto: RejectWithdrawalDto,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.runReviewAction(
      user,
      withdrawalId,
      'reject',
      dto.reason.trim(),
    );
  }

  async pay(
    user: AuthenticatedUser,
    withdrawalId: number,
  ): Promise<ReviewWithdrawalResponseDto> {
    return this.runReviewAction(user, withdrawalId, 'pay');
  }

  /** 审核 / 驳回 / 打款共用同一状态机、审计字段写入与缓存失效链 */
  private async runReviewAction(
    user: AuthenticatedUser,
    withdrawalId: number,
    action: WithdrawalAction,
    rejectReason?: string,
  ): Promise<ReviewWithdrawalResponseDto> {
    const record =
      await this.withdrawalsSharedService.getScopedWithdrawalOrThrow(
        user,
        withdrawalId,
      );
    const rule = assertWithdrawalTransition(action, record.status);
    this.assertNotSelfReview(user, record);
    this.assertOwnerReviewer(user);

    const staffId = user.currentMembership?.staffId ?? null;
    const data = buildWithdrawalTransitionData({
      action,
      now: new Date(),
      staffId,
      rejectReason,
    });

    const response = await this.prisma.$transaction(
      async (tx) => {
        await updateWithdrawalStatusOrThrow(tx, {
          withdrawalId,
          storeId: record.storeId,
          from: rule.from,
          data,
        });
        if (action === 'reject') {
          await refundRejectedWithdrawalOrThrow(tx, record);
        }
        return this.buildReviewResponse(tx, record.storeId, withdrawalId);
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    this.logger.log(
      buildWithdrawalAuditLog({
        action,
        withdrawalId,
        storeId: record.storeId,
        from: record.status,
        staffId,
      }),
    );
    await this.invalidateDashboardCaches(record.storeId);

    return response;
  }

  /** 申请人不可自审自付：同一 staff 既发起又审核/打款属于资金内控缺口 */
  private assertNotSelfReview(
    user: AuthenticatedUser,
    record: WithdrawalRecordSnapshot,
  ): void {
    const staffId = user.currentMembership?.staffId;
    if (staffId != null && record.operatorStaffId === staffId) {
      throw new ForbiddenException('申请人不可自行审核或确认打款');
    }
  }

  /**
   * 提现审核/打款仅限主账号 owner，实现「申请」与「审核」职责分离。
   *
   * 不直接移除 manager 的 partner:review：该权限码同时用于合伙人申请审核，
   * 移除会连带影响合伙人管理页；新增独立权限码又需同步前端权限码白名单。
   * 因此在资金链路单独收紧审核人身份，代价最小且不动既有契约。
   */
  private assertOwnerReviewer(user: AuthenticatedUser): void {
    if (user.currentMembership?.subjectType !== 'owner') {
      throw new ForbiddenException('仅主账号可审核或确认打款');
    }
  }

  private async invalidateDashboardCaches(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateDashboardAndPulseSession(storeId),
      this.cacheInvalidatorService.invalidateWithdrawalsDerived(storeId),
      // 提现会改 beanBalance / totalWithdrawnBeans 并写入豆流水，
      // 必须同时失效豆子中心(bean-logs)与合伙人资料(partner-profile)缓存。
      this.cacheInvalidatorService.invalidatePlatformMembershipDerived(storeId),
      this.cacheInvalidatorService.invalidatePulseGrowthEarnings(storeId),
      // 新建/审核/打款都会改变 pulse「合伙人打款」列表与待打款统计
      this.cacheInvalidatorService.invalidatePulseGrowthAdminQueries(),
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
