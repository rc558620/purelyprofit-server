import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import {
  buildMarketingCustomersListPattern,
  buildMarketingCustomerDetailPattern,
} from '../../redis/cache-keys';
import type { CreateConsumptionDto } from './dto/marketing-query.dto';
import type {
  MarketingConsumptionDto,
  MarketingConsumptionsResponseDto,
} from './dto/marketing-response.dto';
import {
  buildPointsSpendDescription,
  mapConsumptionRow,
} from './marketing.mapper';
import {
  queryConsumptionRowById,
  queryCustomerConsumptionPage,
  queryCustomerTierThresholds,
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  calcCustomerTier,
  cloneDefaultMarketingMemberLevelSettings,
  resolveMarketingPagination,
  safeEnumCoerce,
  MARKETING_PAY_TYPE_VALUES,
  type MarketingPayTypeValue,
} from './marketing.utils';

@Injectable()
export class MarketingConsumptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly redisService: RedisService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listConsumptions(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingConsumptionsResponseDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:view',
    );

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const [rows, total] = await Promise.all([
      queryCustomerConsumptionPage(this.prisma, customerId, skip, take),
      this.prisma.marketingConsumption.count({ where: { customerId } }),
    ]);

    return {
      items: rows.map(mapConsumptionRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async createConsumption(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateConsumptionDto,
  ): Promise<MarketingConsumptionDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    const customer = await this.marketingSharedService.findCustomerOrThrow(
      dto.customerId,
    );
    if (customer.storeId !== storeId) {
      throw new BadRequestException('顾客不属于该门店');
    }

    // D2: 幂等保护，与 createRecharge 一致，5 秒内同参数请求视为重复提交。
    // 占位放在所有业务校验**之后**：否则用户因「余额不足」被拒后，5 秒内修正
    // 金额重试仍会被判重复提交。并发重复扣减由事务内的条件更新兜底。
    const idempotencyKey = `consumption:dedup:${storeId}:${dto.customerId}:${dto.amount}:${dto.balancePaid ?? 0}:${dto.pointsDeducted ?? 0}:${dto.payType ?? 'cash'}:${dto.itemsSummary?.trim() || ''}:${dto.promotionId ?? ''}`;

    const balancePaid = dto.balancePaid ?? 0;
    const rawPointsDeducted = dto.pointsDeducted ?? 0;
    const payType = dto.payType ?? 'cash';

    if (
      Money.fromDbCents(balancePaid).greaterThan(
        Money.fromDbCents(customer.balance),
      )
    ) {
      throw new BadRequestException('余额支付金额不能超过顾客当前余额');
    }
    if (
      Money.fromDbCents(balancePaid).greaterThan(Money.fromDbCents(dto.amount))
    ) {
      throw new BadRequestException('余额支付金额不能超过消费金额');
    }

    // ── B4+B5：读取会员设置，获取 tier 阈值与积分兑换比 ──
    const { thresholds, redeemRatioPoints } =
      await this.resolveTierThresholdsAndPointsRatio(storeId);

    // B5：将「积分抵扣金额（分）」按 redeemRatioPoints 换算为实际扣减积分数
    // redeemRatioPoints = 多少积分抵 1 元；pointsToDeduct = rawPointsDeducted × ratio / 100
    const pointsToDeduct =
      rawPointsDeducted > 0
        ? Math.round((rawPointsDeducted * redeemRatioPoints) / 100)
        : 0;

    if (pointsToDeduct > customer.points) {
      throw new BadRequestException('积分抵扣所需积分不能超过顾客当前积分余额');
    }
    if (
      Money.fromDbCents(balancePaid)
        .add(Money.fromDbCents(rawPointsDeducted))
        .greaterThan(Money.fromDbCents(dto.amount))
    ) {
      throw new BadRequestException('余额支付与积分抵扣之和不能超过消费金额');
    }

    const isNew = await this.redisService.setIfAbsent(idempotencyKey, '1', 5);
    if (!isNew) {
      throw new BadRequestException('请勿重复提交，请稍后再试');
    }

    const [consumptionRecord] = await this.prisma.$transaction(
      async (tx) => {
        const consumption = await tx.marketingConsumption.create({
          data: {
            storeId,
            customerId: dto.customerId,
            amount: dto.amount,
            balancePaid,
            pointsDeducted: rawPointsDeducted,
            // D4: 同时固化「实际扣减积分个数」，与 pointsDeducted（金额分）可独立核对
            actualPointsDeducted: pointsToDeduct,
            // F7: 运行时枚举校验，避免脏值进入数据库
            payType: safeEnumCoerce(
              payType,
              MARKETING_PAY_TYPE_VALUES,
              'cash' as MarketingPayTypeValue,
            ),
            itemsSummary: dto.itemsSummary?.trim() || null,
            promotionId: dto.promotionId ?? null,
          },
        });

        const newTotalSpent = Money.fromDbCents(customer.totalSpent)
          .add(Money.fromDbCents(dto.amount))
          .toDbCents();
        // B4：使用可配置的 tier 阈值而非硬编码
        const newTier = calcCustomerTier(newTotalSpent, thresholds) as never;

        // BUG-3: 事务内下限守卫，防止并发扣成负数
        try {
          await tx.marketingCustomer.update({
            where: {
              id: dto.customerId,
              balance: { gte: balancePaid },
              points: { gte: pointsToDeduct },
            },
            data: {
              balance: { decrement: balancePaid },
              points: { decrement: pointsToDeduct },
              totalSpent: { increment: dto.amount },
              visitCount: { increment: 1 },
              lastVisitAt: new Date(),
              tier: newTier,
            },
          });
        } catch (err: unknown) {
          if (
            err instanceof Error &&
            'code' in err &&
            (err as { code: string }).code === 'P2025'
          ) {
            throw new BadRequestException(
              '余额或积分不足，消费失败；请刷新后重试',
            );
          }
          throw err;
        }

        if (pointsToDeduct > 0) {
          // ⚠️ created_at 显式写 `NOW() AT TIME ZONE 'UTC'`：该列是 TIMESTAMP WITHOUT
          // TIME ZONE，缺省值 CURRENT_TIMESTAMP 取数据库会话时区的墙钟，而 Prisma/驱动
          // 按 UTC 解释 naive 值，会让流水时间比实际快 8 小时。
          await tx.$executeRaw`
          INSERT INTO marketing_points_records (
            store_id,
            customer_id,
            amount,
            type,
            description,
            created_at
          )
          VALUES (
            ${storeId},
            ${dto.customerId},
            ${-pointsToDeduct},
            ${'spend'}::"MarketingPointsChangeType",
            ${buildPointsSpendDescription(dto.itemsSummary)},
            NOW() AT TIME ZONE 'UTC'
          )
        `;
        }

        if (dto.promotionId) {
          await tx.marketingPromotion.updateMany({
            where: { id: dto.promotionId, storeId },
            data: {
              usageCount: { increment: 1 },
            },
          });
        }

        return [consumption] as const;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    const row = await queryConsumptionRowById(
      this.prisma,
      consumptionRecord.id,
    );
    if (!row) {
      throw new NotFoundException('消费记录不存在');
    }

    await this.invalidateOverviewCache(storeId);

    return mapConsumptionRow(row);
  }

  private async invalidateOverviewCache(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      // BUG-2: 消费后同步失效顾客列表缓存
      this.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      // F8: 失效顾客详情缓存
      this.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
      // 消费会改 marketing_customers 的 points / tier / lastVisitAt，
      // 而这三项正是会员列表「可用积分 / 等级 / 最近活跃」的事实源，必须连带失效，
      // 否则会员中心要等 TTL 到期才看到积分与等级变化。
      this.cacheInvalidatorService.invalidateMembersDerived(storeId),
    ]);
  }

  /**
   * 从会员等级设置中解析 tier 阈值（分）与积分兑换比。
   * - tier 阈值：取自门店会员等级设置，与 C 端结算共用 queryCustomerTierThresholds，
   *   保证两条写入链路的升级口径一致
   * - redeemRatioPoints：多少积分抵扣 1 元，用于将「积分抵扣金额」换算为实际扣减积分数
   */
  private async resolveTierThresholdsAndPointsRatio(storeId: number): Promise<{
    thresholds: { gold: number; diamond: number };
    redeemRatioPoints: number;
  }> {
    const defaults = cloneDefaultMarketingMemberLevelSettings();
    const [thresholds, record] = await Promise.all([
      queryCustomerTierThresholds(this.prisma, storeId),
      this.prisma.marketingMemberLevelSetting.findUnique({
        where: { storeId },
        select: { pointsRatio: true },
      }),
    ]);

    // pointsRatio 解析：从 DB JSON 提取 redeemRatioPoints
    const rawRatio =
      record?.pointsRatio && typeof record.pointsRatio === 'object'
        ? (record.pointsRatio as Record<string, unknown>)
        : {};
    const redeemRatioPoints =
      typeof rawRatio.redeemRatioPoints === 'number' &&
      (rawRatio.redeemRatioPoints as number) >= 1
        ? (rawRatio.redeemRatioPoints as number)
        : defaults.pointsRatio.redeemRatioPoints;

    return { thresholds, redeemRatioPoints };
  }
}
