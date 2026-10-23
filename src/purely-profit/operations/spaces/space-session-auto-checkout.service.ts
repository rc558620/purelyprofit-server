import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import {
  mapRenewRecordRows,
  mapSessionItemRows,
} from './space-sessions.mapper';
import {
  buildSettlementPrepaidMetadata,
  buildSpaceSessionSettlement,
  resolveRenewRecordsGrouponFallback,
} from './space-session-settlement.shared';
import { resolveSettlementChannelFromPlatformForRenew } from './space-session-checkout-payload.shared';
import { SpaceSessionSettlementService } from './space-session-settlement.service';
import { resolveVoucherProductName } from './space-care-record-snapshot.shared';
import {
  buildAutoCheckoutLogContext,
  createAutoCheckoutSystemUser,
  resolveAutoCheckoutAt,
} from './space-session-auto-checkout.shared';

// Re-export for external consumers (handover.service, settlement.service)
export { createAutoCheckoutSystemUser } from './space-session-auto-checkout.shared';

/** 自动结账分布式锁 TTL（秒）：处理单门店所有超时会话的最长耗时 */
const AUTO_CHECKOUT_STORE_LOCK_TTL_SECONDS = 30;

@Injectable()
export class SpaceSessionAutoCheckoutService {
  private readonly logger = new Logger(SpaceSessionAutoCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisLockService: RedisLockService,
    private readonly settlementService: SpaceSessionSettlementService,
  ) {}

  /**
   * 后台调度入口：扫描所有门店，对存在待自动结账会话的门店逐一执行自动结账。
   * 由 SpaceAutoCheckoutSchedulerService 定时调用，无需前端访问触发。
   */
  async autoCheckoutAllExpiredSessions(now = Date.now()): Promise<number> {
    const storeIds = await this.findStoresWithPendingAutoCheckoutSessions();
    if (storeIds.length === 0) {
      return 0;
    }

    const systemUser = createAutoCheckoutSystemUser();
    let totalSettled = 0;

    for (const storeId of storeIds) {
      try {
        const settled = await this.autoCheckoutExpiredCountdownSessions(
          systemUser,
          storeId,
          now,
          'scheduler:auto-checkout',
        );
        totalSettled += settled;
      } catch (error) {
        this.logger.error(
          `[space-auto-checkout] store_failed storeId=${storeId} reason=${
            error instanceof Error ? error.name : 'UnknownError'
          }`,
          error instanceof Error ? error.stack : undefined,
        );
      }
    }

    if (totalSettled > 0) {
      this.logger.log(
        `[space-auto-checkout] scheduler_completed stores=${storeIds.length} settled=${totalSettled}`,
      );
    }

    return totalSettled;
  }

  async autoCheckoutExpiredCountdownSessions(
    user: AuthenticatedUser,
    storeId: number,
    now = Date.now(),
    trigger = 'space:auto-checkout',
    requestId?: string,
  ): Promise<number> {
    // 分布式锁：防止多 worker 并发对同一门店执行自动结账
    const lock = await this.redisLockService.acquireLock(
      `space:auto-checkout:store:${storeId}`,
      {
        ttlSeconds: AUTO_CHECKOUT_STORE_LOCK_TTL_SECONDS,
      },
    );

    if (!lock) {
      this.logger.warn(
        `[space-auto-checkout] skipped_concurrent ${buildAutoCheckoutLogContext(
          {
            trigger,
            storeId,
            userId: user.id,
            requestId,
          },
        )}`,
      );
      return 0;
    }

    try {
      const sessions = await this.prisma.spaceSession.findMany({
        where: {
          storeId,
          status: PrismaSpaceSessionStatus.active,
          endTime: null,
          billingMode: PrismaSpaceBillingMode.countdown,
          autoCheckout: true,
          countdownMinutes: {
            not: null,
          },
        },
        include: {
          space: {
            select: {
              id: true,
              name: true,
              enableDirtyRoom: true,
              type: {
                select: {
                  name: true,
                },
              },
            },
          },
          sessionItems: {
            orderBy: { sortOrder: 'asc' },
          },
          sessionRenewRecords: {
            orderBy: { id: 'asc' },
          },
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      });

      let settledCount = 0;
      let failedCount = 0;
      let skippedNoPaymentCount = 0;
      for (const session of sessions) {
        const renewRecords = mapRenewRecordRows(session.sessionRenewRecords);
        // BUG-1/2 fix: hasPrepaid 同时考虑开台预付与续费记录，
        // 不再依赖续费回写的 session.prepaid*（已在 renew.service 中移除）
        const hasPrepaid =
          !!session.prepaidPaymentMethod ||
          !!session.prepaidCustomerPaymentMethod ||
          session.prepaidVoucherFaceAmount !== null ||
          renewRecords.length > 0;

        // BUG-2/5 fix + B9 fix: paymentMethod 优先取开台预付，回退到续费记录的真实支付方式
        // B9: 不再仅匹配 groupon_voucher，而是取最新续费记录的真实 paymentMethod
        const grouponRenewPaymentMethod = renewRecords.find(
          (r) => r.paymentMethod === 'groupon_voucher',
        )?.paymentMethod;
        const latestRenewPaymentMethod =
          renewRecords.length > 0
            ? renewRecords[renewRecords.length - 1].paymentMethod
            : undefined;
        // P2 fix: latestRenewPaymentMethod 优先于 grouponRenewPaymentMethod，
        // 确保最新真实支付方式不被历史团购券记录覆盖。
        // 原顺序 prepaidPaymentMethod → grouponRenewPaymentMethod → latestRenewPaymentMethod
        // 导致「先团购续费、后微信续费」场景下 paymentMethod 被错标为 groupon_voucher。
        const resolvedPaymentMethod =
          session.prepaidPaymentMethod ??
          latestRenewPaymentMethod ??
          grouponRenewPaymentMethod ??
          'cash';
        // BUG-2 fix: customerPaymentMethod / settlementChannel 同理回退到续费记录
        const resolvedCustomerPaymentMethod =
          session.prepaidCustomerPaymentMethod ??
          grouponRenewPaymentMethod ??
          undefined;

        // Bug 8 fix: 从续费记录提取团购信息，作为 session.prepaid* 的回退默认值
        const renewGrouponFallback =
          resolveRenewRecordsGrouponFallback(renewRecords);

        const resolvedSettlementChannel =
          session.prepaidSettlementChannel ??
          (grouponRenewPaymentMethod && renewGrouponFallback.grouponPlatform
            ? resolveSettlementChannelFromPlatformForRenew(
                renewGrouponFallback.grouponPlatform,
              )
            : undefined);
        const checkoutAt = resolveAutoCheckoutAt(session, renewRecords);
        if (checkoutAt === null || checkoutAt > now) {
          continue;
        }

        // 纯消费模式开台用券时，券面会额外生成一条正向消费行，展示名取团购商品名
        const voucherProductName = await resolveVoucherProductName(
          this.prisma,
          session.storeId,
          session.prepaidVoucherCode,
        );
        const settlement = buildSpaceSessionSettlement({
          session,
          checkoutAt,
          payload: {},
          items: mapSessionItemRows(session.sessionItems),
          renewRecords,
          voucherProductName,
        });

        // BUG-4 fix（规则7）：无预付会话不再被永久跳过，到达自动结账时间后必须能结账。
        // 前端开台已保证「自动结账金额 ≥ 台位费」，此处仅做安全兜底：
        // 仅当台位费低于门店最低台位费（理论不可达，hourlyRate 已在开台校验）时跳过，避免 0 元结账。
        if (!hasPrepaid) {
          const tableFeeYuan = Money.fromDbCents(
            session.hourlyRate ?? 0,
          ).toOutputYuan();
          if (settlement.timeCost < tableFeeYuan) {
            skippedNoPaymentCount += 1;
            this.logger.warn(
              `[space-auto-checkout] skipped_no_prepayment_below_table_fee ${buildAutoCheckoutLogContext(
                {
                  trigger,
                  storeId,
                  sessionId: session.id,
                  reason: 'NoPrepaidBelowTableFee',
                  requestId,
                },
              )}`,
            );
            continue;
          }
        }

        try {
          // BUG-1/2 fix: 自动结账支付方式与元数据来自 session.prepaid*（开台预付）
          // 或续费记录回退，不再依赖续费回写的 session.prepaid*
          await this.settlementService.settleSession(user, {
            session,
            checkoutAt,
            paymentMethod: resolvedPaymentMethod,
            note: '倒计时到期自动结账',
            settlement,
            renewRecords,
            voucherProductName,
            ...(resolvedCustomerPaymentMethod
              ? { customerPaymentMethod: resolvedCustomerPaymentMethod }
              : {}),
            ...(resolvedSettlementChannel
              ? { settlementChannel: resolvedSettlementChannel }
              : {}),
            // BUG-3 fix + BUG-4 fix: 团购元数据回退链（无 checkout payload 层）
            // = session.prepaid*（开台预付）→ 续费记录。
            // 三选一规则已收敛到 buildSettlementPrepaidMetadata，与手工结账共用同一实现。
            ...buildSettlementPrepaidMetadata({
              session,
              renewGrouponFallback,
            }),
          });
          settledCount += 1;
        } catch (error) {
          if (
            error instanceof ConflictException ||
            error instanceof NotFoundException
          ) {
            this.logger.warn(
              `[space-auto-checkout] skipped_session ${buildAutoCheckoutLogContext(
                {
                  trigger,
                  storeId,
                  sessionId: session.id,
                  reason: error.constructor.name,
                  requestId,
                },
              )}`,
            );
            continue;
          }
          failedCount += 1;
          this.logger.error(
            `[space-auto-checkout] failed ${buildAutoCheckoutLogContext({
              trigger,
              storeId,
              sessionId: session.id,
              reason: error instanceof Error ? error.name : 'UnknownError',
              requestId,
            })}`,
            error instanceof Error ? error.stack : undefined,
          );
          continue;
        }
      }

      if (settledCount > 0 || failedCount > 0 || skippedNoPaymentCount > 0) {
        this.logger.log(
          `[space-auto-checkout] completed ${buildAutoCheckoutLogContext({
            trigger,
            storeId,
            count: settledCount,
            failedCount,
            skippedNoPaymentCount,
            requestId,
          })}`,
        );
      }

      return settledCount;
    } catch (error) {
      this.logger.error(
        `[space-auto-checkout] aborted ${buildAutoCheckoutLogContext({
          trigger,
          storeId,
          userId: user.id,
          requestId,
          reason: error instanceof Error ? error.name : 'UnknownError',
        })}`,
        error instanceof Error ? error.stack : undefined,
      );
      return 0;
    } finally {
      // 与 settlement.service 口径一致：释放失败只告警，不掩盖业务结果/原始异常
      try {
        await this.redisLockService.releaseLock(lock);
      } catch (error) {
        this.logger.warn(
          `[space-auto-checkout] releaseLock failed storeId=${storeId} reason=${
            error instanceof Error ? error.name : 'UnknownError'
          }`,
        );
      }
    }
  }

  private async findStoresWithPendingAutoCheckoutSessions(): Promise<number[]> {
    // 索引列等值条件（命中 (status, autoCheckout, billingMode, endTime) 复合索引）
    const baseWhere = {
      status: PrismaSpaceSessionStatus.active,
      endTime: null,
      billingMode: PrismaSpaceBillingMode.countdown,
      autoCheckout: true,
      countdownMinutes: { not: null },
    } satisfies Prisma.SpaceSessionWhereInput;

    // 性能：原实现把「预付费/台位费」标量条件与「有续费记录」半连接塞进同一个 OR，
    // 计划器难以同时利用复合索引与半连接。拆成两条形态简单的查询，
    // 门店维度取并集 —— 与旧 OR 语义完全一致（BUG-1/2/4 的匹配范围不变）。
    const [prepaidOrRatedSessions, renewedSessions] = await Promise.all([
      this.prisma.spaceSession.findMany({
        where: {
          ...baseWhere,
          OR: [
            { prepaidPaymentMethod: { not: null } },
            { prepaidCustomerPaymentMethod: { not: null } },
            { prepaidVoucherFaceAmount: { not: null } },
            { hourlyRate: { gt: 0 } },
          ],
        },
        select: { storeId: true },
      }),
      this.prisma.spaceSession.findMany({
        where: {
          ...baseWhere,
          sessionRenewRecords: { some: {} },
        },
        select: { storeId: true },
      }),
    ]);

    return Array.from(
      new Set([
        ...prepaidOrRatedSessions.map((session) => session.storeId),
        ...renewedSessions.map((session) => session.storeId),
      ]),
    ).sort((left, right) => left - right);
  }
}
