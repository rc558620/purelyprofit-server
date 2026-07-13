import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import {
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
  buildSpaceSessionSettlement,
  resolveRenewRecordsGrouponFallback,
} from './space-session-settlement.shared';
import { resolveSettlementChannelFromPlatformForRenew } from './space-session-checkout-payload.shared';
import { SpaceSessionSettlementService } from './space-session-settlement.service';

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
        `[space-auto-checkout] skipped_concurrent ${this.buildAutoCheckoutLogContext(
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

        const settlement = buildSpaceSessionSettlement({
          session,
          checkoutAt,
          payload: {},
          items: mapSessionItemRows(session.sessionItems),
          renewRecords,
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
              `[space-auto-checkout] skipped_no_prepayment_below_table_fee ${this.buildAutoCheckoutLogContext(
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
            ...(resolvedCustomerPaymentMethod
              ? { customerPaymentMethod: resolvedCustomerPaymentMethod }
              : {}),
            ...(resolvedSettlementChannel
              ? { settlementChannel: resolvedSettlementChannel }
              : {}),
            ...((session.prepaidGrouponCode ?? renewGrouponFallback.grouponCode)
              ? {
                  grouponCode:
                    session.prepaidGrouponCode ??
                    renewGrouponFallback.grouponCode!,
                }
              : {}),
            ...((session.prepaidGrouponPlatform ??
            renewGrouponFallback.grouponPlatform)
              ? {
                  grouponPlatform:
                    session.prepaidGrouponPlatform ??
                    renewGrouponFallback.grouponPlatform!,
                }
              : {}),
            ...((session.prepaidVoucherCode ?? renewGrouponFallback.grouponCode)
              ? {
                  voucherCode:
                    session.prepaidVoucherCode ??
                    renewGrouponFallback.grouponCode!,
                }
              : {}),
            ...((session.prepaidVoucherPlatform ??
            renewGrouponFallback.grouponPlatform)
              ? {
                  voucherPlatform:
                    session.prepaidVoucherPlatform ??
                    renewGrouponFallback.grouponPlatform!,
                }
              : {}),
            // BUG-3 fix: 续费回退来源的 voucherFaceAmount 不写入 session.prepaidVoucherFaceAmount，
            // 防止续费券面污染预付池、保持「两池独立」不变量。
            ...(session.prepaidVoucherFaceAmount !== null
              ? {
                  voucherFaceAmount: Money.fromDbCents(
                    session.prepaidVoucherFaceAmount,
                  ).toOutputYuan(),
                }
              : renewGrouponFallback.voucherFaceAmount !== undefined
                ? {
                    voucherFaceAmount: renewGrouponFallback.voucherFaceAmount,
                    skipPrepaidVoucherPersistence: true,
                  }
                : {}),
          });
          settledCount += 1;
        } catch (error) {
          if (
            error instanceof ConflictException ||
            error instanceof NotFoundException
          ) {
            this.logger.warn(
              `[space-auto-checkout] skipped_session ${this.buildAutoCheckoutLogContext(
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
            `[space-auto-checkout] failed ${this.buildAutoCheckoutLogContext({
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
          `[space-auto-checkout] completed ${this.buildAutoCheckoutLogContext({
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
        `[space-auto-checkout] aborted ${this.buildAutoCheckoutLogContext({
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
      await this.redisLockService.releaseLock(lock);
    }
  }

  private buildAutoCheckoutLogContext(params: {
    trigger: string;
    storeId: number;
    requestId?: string;
    userId?: number;
    sessionId?: number;
    count?: number;
    failedCount?: number;
    skippedNoPaymentCount?: number;
    reason?: string;
  }): string {
    const segments = [
      `trigger=${params.trigger}`,
      `storeId=${params.storeId}`,
      ...(params.requestId ? [`requestId=${params.requestId}`] : []),
      ...(params.userId !== undefined ? [`userId=${params.userId}`] : []),
      ...(params.sessionId !== undefined
        ? [`sessionId=${params.sessionId}`]
        : []),
      ...(params.count !== undefined ? [`count=${params.count}`] : []),
      ...(params.failedCount !== undefined
        ? [`failedCount=${params.failedCount}`]
        : []),
      ...(params.skippedNoPaymentCount !== undefined
        ? [`skippedNoPaymentCount=${params.skippedNoPaymentCount}`]
        : []),
      ...(params.reason ? [`reason=${params.reason}`] : []),
    ];

    return segments.join(' ');
  }

  private async findStoresWithPendingAutoCheckoutSessions(): Promise<number[]> {
    const sessions = await this.prisma.spaceSession.findMany({
      where: {
        status: PrismaSpaceSessionStatus.active,
        endTime: null,
        billingMode: PrismaSpaceBillingMode.countdown,
        autoCheckout: true,
        // BUG-1/2 fix: 扩展门店预筛选，同时匹配开台预付与有续费记录的会话
        // BUG-4 fix: 无预付但有有效台位费（hourlyRate > 0）的会话也需被调度扫描
        OR: [
          { prepaidPaymentMethod: { not: null } },
          { prepaidCustomerPaymentMethod: { not: null } },
          { prepaidVoucherFaceAmount: { not: null } },
          { sessionRenewRecords: { some: {} } },
          { hourlyRate: { gt: 0 } },
        ],
        countdownMinutes: { not: null },
      },
      select: { storeId: true },
      distinct: ['storeId'],
      orderBy: { storeId: 'asc' },
    });

    return sessions.map((session) => session.storeId);
  }
}

const resolveAutoCheckoutAt = (
  session: {
    startTime: Date;
    countdownMinutes: number | null;
  },
  _renewRecords: Array<{
    addedMinutes: number;
  }>,
): number | null => {
  // 契约断言：countdownMinutes 必须是累计值（由 renew.service 在续费时累加）。
  // 如果此断言失败，说明续费实现已变更为"只写 renewRecords 不累加 countdownMinutes"，
  // 需要修改此函数改为从 renewRecords 推导。
  // _renewRecords 参数保留以支持未来从 renewRecords 推导的迁移路径。
  if (session.countdownMinutes === null || session.countdownMinutes <= 0) {
    return null;
  }

  // B1 fix: countdownMinutes 已是累计值（续费时由 space-session-renew.service
  // 直接累加），不应再叠加 renewRecords.addedMinutes，否则续费分钟被双重计算。
  return session.startTime.getTime() + session.countdownMinutes * 60 * 1000;
};

/**
 * 构建后台自动结账使用的系统用户。
 * 该用户无实际 membership，因此销售单创建会直接使用传入的可信门店，
 * 且 shouldAssignToCurrentShiftOperator 会返回 false，避免误归属到虚拟操作人。
 */
export const createAutoCheckoutSystemUser = (): AuthenticatedUser => ({
  id: 0,
  email: 'system@auto-checkout',
  phone: '',
  name: '系统自动结账',
  createdAt: new Date(),
  updatedAt: new Date(),
  lastActiveAt: null,
  currentMembership: null,
});
