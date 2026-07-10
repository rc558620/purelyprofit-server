import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  SpaceBillingMode as PrismaSpaceBillingMode,
  SpaceSessionStatus as PrismaSpaceSessionStatus,
} from '@prisma/client';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { Money } from '../../../shared/money.utils';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  PrismaService,
  TX_TIMEOUT_MEDIUM,
} from '../../../prisma/prisma.service';
import { RedisLockService } from '../../../redis/redis-lock.service';
import type {
  RenewSpaceSessionDto,
  RenewSpaceSessionResponseDto,
} from './dto/space-session.dto';
import { toSpaceSessionResponse } from './space-sessions.mapper';
import { normalizeRenewPayload } from './space-session-payload.shared';
import type { SpaceSessionRenewRecord } from './space-sessions.types';

const generateSpaceSessionRenewRecordId = (): string => `rn_${randomUUID()}`;

/** 溢出保护：countdownMinutes 累计上限（分钟），约等于 10 年的分钟数 */
const COUNTDOWN_MINUTES_MAX = 5_256_000;

/** B2 fix: 续费分布式去重锁 TTL（秒），覆盖事务最坏耗时（含 FOR UPDATE 等待 + DB 压力） */
const RENEW_LOCK_TTL_SECONDS = 30;

@Injectable()
export class SpaceSessionRenewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly redisLockService: RedisLockService,
  ) {}

  async renewSession(
    user: AuthenticatedUser,
    sessionId: number,
    dto: RenewSpaceSessionDto,
  ): Promise<RenewSpaceSessionResponseDto> {
    // BUG-1 fix: 与 checkout / list / detail 的 deletedAt: null 口径一致
    const session = await this.prisma.spaceSession.findFirst({
      where: {
        id: sessionId,
        space: { deletedAt: null },
      },
      select: {
        id: true,
        storeId: true,
      },
    });

    if (!session) {
      throw new NotFoundException('空间会话不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      session.storeId,
      'operation-entry:create',
      '无权在该门店空间续费',
    );

    const payload = normalizeRenewPayload(dto);

    // BUG-3 fix: Redis 分布式去重锁，防止快速重复点击产生双重加钟/双重抵扣
    const lock = await this.redisLockService.acquireLock(
      `space:session:renew:${sessionId}`,
      { ttlSeconds: RENEW_LOCK_TTL_SECONDS },
    );
    if (!lock) {
      throw new ConflictException('当前会话正在续费中，请稍后重试');
    }

    try {
      const result = await this.prisma.$transaction(
        async (transaction) => {
          await transaction.$queryRaw`
          SELECT id
          FROM space_sessions
          WHERE id = ${sessionId}
          FOR UPDATE
        `;

          const latestSession = await transaction.spaceSession.findUnique({
            where: { id: sessionId },
            include: {
              space: {
                select: {
                  id: true,
                  name: true,
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
          });

          if (!latestSession) {
            throw new NotFoundException('空间会话不存在');
          }

          if (latestSession.status !== PrismaSpaceSessionStatus.active) {
            throw new ConflictException('当前会话已结账，无法继续续费');
          }

          // 纯消费模式无 hourlyRate，续费语义不成立；timed / mixed / countdown 均可续费
          if (latestSession.billingMode === PrismaSpaceBillingMode.items) {
            throw new ConflictException('纯消费模式不支持续费');
          }

          // hourlyRate 在 DB 中是分，通过 Money 全程运算
          if (!latestSession.hourlyRate) {
            throw new BadRequestException('当前会话缺少有效台位费，无法续费');
          }
          const hourlyRateMoney = Money.fromDbCents(latestSession.hourlyRate);
          if (hourlyRateMoney.isZero() || hourlyRateMoney.isNegative()) {
            throw new BadRequestException('当前会话缺少有效台位费，无法续费');
          }

          // 续费金额（元）→ Money → 换算分钟数（向下取整）
          const amountMoney = Money.fromInputYuan(payload.amount);
          // Bug 4 fix: 团购券场景下，取 amount 与 voucherFaceAmount 的较大值计算服务时长
          // "花 80 享 100"→ 按 100 元算分钟；无团购时退化为原 amount
          const effectiveAmountMoney =
            payload.voucherFaceAmount !== undefined
              ? Money.max(
                  amountMoney,
                  Money.fromInputYuan(payload.voucherFaceAmount),
                )
              : amountMoney;
          const addedMinutes = effectiveAmountMoney.calcWholeUnitsFloor(
            hourlyRateMoney,
            60,
          );
          // 溢出保护：单次续费分钟数不应超过上限
          const safeAddedMinutes = Math.min(
            addedMinutes,
            COUNTDOWN_MINUTES_MAX,
          );
          if (safeAddedMinutes <= 0) {
            throw new BadRequestException('续费金额不足以换算有效时长');
          }

          const recordId = generateSpaceSessionRenewRecordId();
          const renewRecord: SpaceSessionRenewRecord = {
            id: recordId,
            amount: payload.amount,
            addedMinutes: safeAddedMinutes,
            paymentMethod: payload.paymentMethod,
            ...(payload.grouponCode
              ? { grouponCode: payload.grouponCode }
              : {}),
            ...(payload.grouponPlatform
              ? { grouponPlatform: payload.grouponPlatform }
              : {}),
            ...(payload.voucherFaceAmount !== undefined
              ? { voucherFaceAmount: payload.voucherFaceAmount }
              : {}),
            ...(payload.note ? { note: payload.note } : {}),
            renewedAt: Date.now(),
          };

          // Step 8.1: 写入独立表而非 JSON
          // payload.amount 是元，DB 存储为分
          await transaction.spaceSessionRenewRecord.create({
            data: {
              sessionId: latestSession.id,
              recordId,
              amount: Money.fromInputYuan(payload.amount).toDbCents(),
              addedMinutes: safeAddedMinutes,
              paymentMethod: payload.paymentMethod,
              grouponCode: payload.grouponCode ?? null,
              grouponPlatform: payload.grouponPlatform ?? null,
              voucherFaceAmount:
                payload.voucherFaceAmount !== undefined
                  ? Money.fromInputYuan(payload.voucherFaceAmount).toDbCents()
                  : null,
              note: payload.note ?? null,
              renewedAt: renewRecord.renewedAt,
            },
          });

          // R3 fix: 仅 countdown 模式续费累加 countdownMinutes（控制自动结账到期时间）
          // timed / mixed 模式时长由真实时钟 startTime→checkoutAt 决定，countdownMinutes 不参与计费
          const sessionUpdateData: Record<string, unknown> = {};
          if (latestSession.billingMode === PrismaSpaceBillingMode.countdown) {
            const nextCountdown =
              (latestSession.countdownMinutes ?? 0) + safeAddedMinutes;
            sessionUpdateData.countdownMinutes = Math.min(
              nextCountdown,
              COUNTDOWN_MINUTES_MAX,
            );
          }

          // BUG-1/5/7 fix: 移除团购续费回写 session.prepaid* 的逻辑。
          // 续费信息已完整记录在 spaceSessionRenewRecord 表中，
          // 结算时 renewDeduction 从续费记录计算，prepaidDeduction 仅来自开台预付——
          // 两池独立，杜绝重复抵扣。
          // 自动结账 hasPrepaid / paymentMethod 已改为同时读取续费记录，
          // 不再依赖 session.prepaid* 回写。

          const updated = await transaction.spaceSession.update({
            where: { id: latestSession.id },
            data: sessionUpdateData,
            include: {
              space: {
                select: {
                  id: true,
                  name: true,
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
          });

          return {
            renewRecord,
            updated,
          };
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      );

      return {
        renewRecord: { ...result.renewRecord },
        session: toSpaceSessionResponse(result.updated),
      };
    } finally {
      await this.redisLockService.releaseLock(lock);
    }
  }
}
