import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import {
  parseSpaceSessionItems,
  parseSpaceSessionRenewRecords,
} from './space-sessions.mapper';
import { buildSpaceSessionSettlement } from './space-session-settlement.shared';
import { SpaceSessionSettlementService } from './space-session-settlement.service';

const AUTO_CHECKOUT_STORE_LOCK_TTL_SECONDS = 30;

@Injectable()
export class SpaceSessionAutoCheckoutService {
  private readonly logger = new Logger(SpaceSessionAutoCheckoutService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
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
    let lock: { key: string; token: string } | null = null;

    try {
      lock = await this.acquireAutoCheckoutStoreLock(storeId);
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
        },
        orderBy: [{ startTime: 'asc' }, { id: 'asc' }],
      });

      let settledCount = 0;
      let failedCount = 0;
      for (const session of sessions) {
        if (!session.prepaidPaymentMethod) {
          continue;
        }

        const renewRecords = parseSpaceSessionRenewRecords(
          session.renewRecords,
        );
        const checkoutAt = resolveAutoCheckoutAt(session, renewRecords);
        if (checkoutAt === null || checkoutAt > now) {
          continue;
        }

        const settlement = buildSpaceSessionSettlement({
          session,
          checkoutAt,
          payload: {},
          items: parseSpaceSessionItems(session.items),
          renewRecords,
        });

        try {
          await this.settlementService.settleSession(user, {
            session,
            checkoutAt,
            paymentMethod: session.prepaidPaymentMethod,
            note: '倒计时到期自动结账',
            settlement,
            renewRecords,
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

      if (settledCount > 0 || failedCount > 0) {
        this.logger.log(
          `[space-auto-checkout] completed ${this.buildAutoCheckoutLogContext({
            trigger,
            storeId,
            count: settledCount,
            failedCount,
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
      if (lock) {
        try {
          await this.releaseAutoCheckoutStoreLock(lock);
        } catch (error) {
          this.logger.warn(
            `[space-auto-checkout] release_lock_failed ${this.buildAutoCheckoutLogContext(
              {
                trigger,
                storeId,
                userId: user.id,
                requestId,
                reason: error instanceof Error ? error.name : 'UnknownError',
              },
            )}`,
          );
        }
      }
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
      ...(params.reason ? [`reason=${params.reason}`] : []),
    ];

    return segments.join(' ');
  }

  private async acquireAutoCheckoutStoreLock(
    storeId: number,
  ): Promise<{ key: string; token: string } | null> {
    const token = randomUUID();
    const lockKey = `space:auto-checkout:store:${storeId}`;
    const result = await this.redisService
      .getClient()
      .set(lockKey, token, 'EX', AUTO_CHECKOUT_STORE_LOCK_TTL_SECONDS, 'NX');

    return result === 'OK'
      ? {
          key: lockKey,
          token,
        }
      : null;
  }

  private async releaseAutoCheckoutStoreLock(lock: {
    key: string;
    token: string;
  }): Promise<void> {
    await this.redisService.getClient().eval(
      `
        if redis.call('GET', KEYS[1]) == ARGV[1] then
          return redis.call('DEL', KEYS[1])
        end
        return 0
      `,
      1,
      lock.key,
      lock.token,
    );
  }

  private async findStoresWithPendingAutoCheckoutSessions(): Promise<number[]> {
    const sessions = await this.prisma.spaceSession.findMany({
      where: {
        status: PrismaSpaceSessionStatus.active,
        endTime: null,
        billingMode: PrismaSpaceBillingMode.countdown,
        autoCheckout: true,
        prepaidPaymentMethod: { not: null },
        countdownMinutes: { not: null },
      },
      select: { storeId: true },
      distinct: ['storeId'],
    });

    return sessions.map((session) => session.storeId);
  }
}

const resolveAutoCheckoutAt = (
  session: {
    startTime: Date;
    countdownMinutes: number | null;
  },
  renewRecords: Array<{
    addedMinutes: number;
  }>,
): number | null => {
  if (session.countdownMinutes === null || session.countdownMinutes <= 0) {
    return null;
  }

  const totalMinutes = renewRecords.reduce(
    (sum, record) => sum + record.addedMinutes,
    session.countdownMinutes,
  );

  return session.startTime.getTime() + totalMinutes * 60 * 1000;
};

/**
 * 构建后台自动结账使用的系统用户。
 * 该用户无实际 membership，因此销售单创建会直接使用传入的可信门店，
 * 且 shouldAssignToCurrentShiftOperator 会返回 false，避免误归属到虚拟操作人。
 */
const createAutoCheckoutSystemUser = (): AuthenticatedUser => ({
  id: 0,
  email: 'system@auto-checkout',
  phone: '',
  name: '系统自动结账',
  createdAt: new Date(),
  updatedAt: new Date(),
  currentMembership: null,
});
