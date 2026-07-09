import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import {
  buildMarketingCustomersListPattern,
  buildMarketingCustomerDetailPattern,
} from '../../redis/cache-keys';
import type {
  CreateRechargeDto,
  ListRechargesQueryDto,
} from './dto/marketing-query.dto';
import type {
  MarketingRechargeDto,
  MarketingRechargesResponseDto,
} from './dto/marketing-response.dto';
import { buildRechargeCountWhere } from './marketing.domain';
import { mapRechargeRow } from './marketing.mapper';
import type { MarketingRechargeRow } from './marketing.types';
import {
  queryCustomerGiftBalanceCents,
  queryCustomerRechargePage,
  queryCustomerRefundPage,
  queryRechargePage,
  queryRechargeRowById,
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import { Money } from '../../shared/money.utils';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
  safeEnumCoerce,
  MARKETING_RECHARGE_TYPE_VALUES,
  type MarketingRechargeTypeValue,
} from './marketing.utils';

@Injectable()
export class MarketingRechargesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly redisService: RedisService,
  ) {}

  async listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto,
  ): Promise<MarketingRechargesResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(
          0,
          1,
          resolveMarketingPagination(query.page, query.pageSize).take,
        ),
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const listQuery = {
      storeId: resolvedStoreId,
      customerId: query.customerId,
      startMs: query.startMs,
      endMs: query.endMs,
    };

    const [rows, total] = await Promise.all([
      queryRechargePage(this.prisma, { ...listQuery, skip, take }),
      this.prisma.marketingRecharge.count({
        where: buildRechargeCountWhere(listQuery),
      }),
    ]);

    return {
      items: rows.map(mapRechargeRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async listCustomerRecharges(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
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
      queryCustomerRechargePage(this.prisma, customerId, skip, take),
      this.prisma.marketingRecharge.count({
        where: {
          customerId,
          type: { in: ['recharge', 'gift'] },
        },
      }),
    ]);

    return {
      items: rows.map(mapRechargeRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  async listCustomerRefunds(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number },
  ): Promise<MarketingRechargesResponseDto> {
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
      queryCustomerRefundPage(this.prisma, customerId, skip, take),
      this.prisma.marketingRecharge.count({
        where: {
          customerId,
          type: 'refund',
        },
      }),
    ]);

    // 为退款记录计算赠送清零金额
    const items = await this.enrichRefundGiftCleared(customerId, rows);

    return {
      items,
      meta: buildMarketingPaginationMeta(total, page, take),
    };
  }

  /**
   * 为退款记录补充 giftCleared 字段。
   * 通过按时间顺序遍历所有充值记录，计算每笔退款时的赠送余额。
   */
  private async enrichRefundGiftCleared(
    customerId: number,
    pageRows: MarketingRechargeRow[],
  ): Promise<MarketingRechargeDto[]> {
    // 检查是否有退款记录需要处理
    const hasRefund = pageRows.some((r) => (r.type as string) === 'refund');
    if (!hasRefund) {
      return pageRows.map(mapRechargeRow);
    }

    // 获取所有充值记录（按时间升序）用于计算赠送余额
    const allRows = await this.prisma.$queryRaw<MarketingRechargeRow[]>`
      SELECT id, amount, gift_amount AS "giftAmount", total_amount AS "totalAmount",
             type::text AS "type", created_at AS "createdAt"
      FROM marketing_recharges
      WHERE customer_id = ${customerId}
      ORDER BY created_at ASC, id ASC
    `;

    // 构建 refundId -> giftCleared 映射（基于时间线 trackedGift 算法）
    const giftClearedMap = new Map<number, number>();
    let trackedGift = 0;

    for (const row of allRows) {
      const type = row.type as string;
      if (type === 'recharge' || type === 'gift') {
        trackedGift += row.giftAmount;
      } else if (type === 'refund') {
        // BUG-1: 退款实际清零的赠送金额 = min(trackedGift, row.giftAmount)
        const cleared = Math.min(trackedGift, row.giftAmount);
        giftClearedMap.set(row.id, cleared);
        trackedGift = Math.max(0, trackedGift - row.giftAmount);
      }
    }

    return pageRows.map((row) => {
      const dto = mapRechargeRow(row);
      if ((row.type as string) === 'refund') {
        const giftCleared = giftClearedMap.get(row.id) ?? 0;
        if (giftCleared > 0) {
          // B5: 使用结构化字段返回赠送清零金额
          dto.giftClearedAmount = Money.fromDbCents(giftCleared).toOutputYuan();
        }
      }
      return dto;
    });
  }

  async createRecharge(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateRechargeDto,
  ): Promise<MarketingRechargeDto> {
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

    const rechargeType = dto.type ?? 'recharge';

    // ── 幂等保护：同一笔操作 5 秒内不可重复提交 ──
    // F5: key 包含 clearRemainingGift，防止不同清零策略的请求被误判为重复
    const idempotencyKey = `recharge:dedup:${storeId}:${dto.customerId}:${rechargeType}:${dto.amount}:${dto.giftAmount ?? 0}:${dto.clearRemainingGift ?? false}:${dto.note?.trim() || ''}`;
    const isNew = await this.redisService.setIfAbsent(idempotencyKey, '1', 5);
    if (!isNew) {
      throw new BadRequestException('请勿重复提交，请稍后再试');
    }

    // ── 退款不允许携带赠送金额（前端传入的 giftAmount 必须为 0，服务端会内部计算清零额） ──
    if (rechargeType === 'refund' && (dto.giftAmount ?? 0) !== 0) {
      throw new BadRequestException('退款操作不允许携带赠送金额');
    }

    // ── 金额全链路走 Money：入站分→Money 对象→计算→入库分 ──
    const rechargeMoney = Money.fromDbCents(dto.amount);
    const giftMoney = Money.fromDbCents(dto.giftAmount ?? 0);
    const totalMoney = rechargeMoney.add(giftMoney);

    // recharge / refund 要求 amount > 0；gift 允许 amount=0 但 totalAmount 须 > 0
    if (rechargeType !== 'gift' && dto.amount < 1) {
      throw new BadRequestException(
        rechargeType === 'refund' ? '退款金额必须大于 0' : '充值金额必须大于 0',
      );
    }
    if (rechargeType === 'gift' && totalMoney.toDbCents() <= 0) {
      throw new BadRequestException('赠送金额必须大于 0');
    }

    // ── 退款预校验：退款金额不能超过可退本金，且不能超过当前实际余额 ──
    if (rechargeType === 'refund') {
      const [rechargeAgg, refundAgg] = await Promise.all([
        this.prisma.marketingRecharge.aggregate({
          where: { customerId: dto.customerId, type: 'recharge' },
          _sum: { amount: true },
        }),
        this.prisma.marketingRecharge.aggregate({
          where: { customerId: dto.customerId, type: 'refund' },
          _sum: { amount: true },
        }),
      ]);
      const refundableCents = Math.max(
        0,
        (rechargeAgg._sum.amount ?? 0) - (refundAgg._sum.amount ?? 0),
      );
      if (Money.fromDbCents(refundableCents).lessThan(totalMoney)) {
        throw new BadRequestException('退款金额不能超过最大可退本金');
      }
      // B1: 余额兗底校验——退款金额不得超过当前实际余额
      if (Money.fromDbCents(customer.balance).lessThan(totalMoney)) {
        throw new BadRequestException('退款金额不能超过顾客当前储值余额');
      }
    }

    let giftClearedAmountCents = 0;
    const [rechargeRecord] = await this.prisma.$transaction(
      async (tx) => {
        // 事务内重新校验退款金额，防止并发退款导致超额退款
        let actualBalanceDeltaCents: number;
        let noteForDb: string | null = dto.note?.trim() || null;
        if (rechargeType === 'refund') {
          const freshCustomer = await tx.marketingCustomer.findUnique({
            where: { id: dto.customerId },
            select: { balance: true },
          });
          if (!freshCustomer) {
            throw new BadRequestException('顾客不存在');
          }
          const [rechargeAgg, refundAgg] = await Promise.all([
            tx.marketingRecharge.aggregate({
              where: { customerId: dto.customerId, type: 'recharge' },
              _sum: { amount: true },
            }),
            tx.marketingRecharge.aggregate({
              where: { customerId: dto.customerId, type: 'refund' },
              _sum: { amount: true },
            }),
          ]);
          const refundableCents = Math.max(
            0,
            (rechargeAgg._sum.amount ?? 0) - (refundAgg._sum.amount ?? 0),
          );
          if (Money.fromDbCents(refundableCents).lessThan(totalMoney)) {
            throw new BadRequestException('退款金额不能超过最大可退本金');
          }

          // 计算赠送金额余额：基于时间线遍历，退款清零 + 充值重新累计
          const giftBalanceCents = await queryCustomerGiftBalanceCents(
            tx,
            dto.customerId,
          );
          const clearGift = dto.clearRemainingGift === true;
          actualBalanceDeltaCents = clearGift
            ? -(totalMoney.toDbCents() + giftBalanceCents)
            : -totalMoney.toDbCents();

          // B1: 事务内余额兗底校验——实际扣减额不得超过当前余额
          if (
            Money.fromDbCents(freshCustomer.balance).lessThan(
              Money.fromDbCents(Math.abs(actualBalanceDeltaCents)),
            )
          ) {
            throw new BadRequestException(
              '退款金额（含赠送清零）不能超过顾客当前储值余额',
            );
          }

          // 在 note 中追加赠送清零金额（向后兼容），同时记录结构化字段
          if (clearGift && giftBalanceCents > 0) {
            giftClearedAmountCents = giftBalanceCents;
            const giftClearedYuan =
              Money.fromDbCents(giftBalanceCents).toOutputYuan();
            noteForDb = `${noteForDb ?? ''} | 赠送清零¥${giftClearedYuan}`;
          }
        } else {
          actualBalanceDeltaCents = totalMoney.toDbCents();
        }

        const recharge = await tx.marketingRecharge.create({
          data: {
            storeId,
            customerId: dto.customerId,
            amount: rechargeMoney.toDbCents(),
            // BUG-1: 退款记录存储实际清零的赠送金额，供读取算法使用
            giftAmount:
              rechargeType === 'refund'
                ? giftClearedAmountCents
                : giftMoney.toDbCents(),
            totalAmount: totalMoney.toDbCents(),
            // F7: 运行时枚举校验，避免脏值进入数据库
            type: safeEnumCoerce(
              rechargeType,
              MARKETING_RECHARGE_TYPE_VALUES,
              'recharge' as MarketingRechargeTypeValue,
            ),
            promotionId: dto.promotionId ?? null,
            note: noteForDb,
          },
        });

        await tx.marketingCustomer.update({
          where: { id: dto.customerId },
          data: { balance: { increment: actualBalanceDeltaCents } },
        });

        if (dto.promotionId && rechargeType !== 'refund') {
          // 校验 promotionId 存在性且归属当前门店
          const promotion = await tx.marketingPromotion.findUnique({
            where: { id: dto.promotionId },
            select: { storeId: true },
          });
          if (!promotion || promotion.storeId !== storeId) {
            throw new BadRequestException('关联活动不存在或不属于当前门店');
          }
          await tx.marketingPromotion.updateMany({
            where: { id: dto.promotionId, storeId },
            data: {
              usageCount: { increment: 1 },
              totalDiscount: { increment: giftMoney.toDbCents() },
            },
          });
        }

        return [recharge] as const;
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    const row = await queryRechargeRowById(this.prisma, rechargeRecord.id);
    if (!row) {
      throw new NotFoundException('充值记录不存在');
    }

    await this.invalidateOverviewCache(storeId);

    const result = mapRechargeRow(row);
    // B5: 返回结构化赠送清零金额（事务内计算）
    if (giftClearedAmountCents > 0) {
      result.giftClearedAmount = Money.fromDbCents(
        giftClearedAmountCents,
      ).toOutputYuan();
    }
    return result;
  }

  private async invalidateOverviewCache(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      // BUG-2: 充值/退款后同步失效顾客列表缓存
      this.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      // F8: 失效顾客详情缓存
      this.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
    ]);
  }
}
