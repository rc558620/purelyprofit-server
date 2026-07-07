import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
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
import {
  queryCustomerRechargePage,
  queryRechargePage,
  queryRechargeRowById,
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import { Money } from '../../shared/money.utils';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
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
      this.prisma.marketingRecharge.count({ where: { customerId } }),
    ]);

    return {
      items: rows.map(mapRechargeRow),
      meta: buildMarketingPaginationMeta(total, page, take),
    };
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
    const idempotencyKey = `recharge:dedup:${storeId}:${dto.customerId}:${rechargeType}:${dto.amount}:${dto.giftAmount ?? 0}:${dto.note?.trim() || ''}`;
    const isNew = await this.redisService.setIfAbsent(idempotencyKey, '1', 5);
    if (!isNew) {
      throw new BadRequestException('请勿重复提交，请稍后再试');
    }

    // ── 退款不允许携带赠送金额 ──
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

    if (
      rechargeType === 'refund' &&
      Money.fromDbCents(customer.balance).lessThan(totalMoney)
    ) {
      throw new BadRequestException('退款金额不能超过顾客当前余额');
    }

    const [rechargeRecord] = await this.prisma.$transaction(
      async (tx) => {
        // 事务内重新读取最新余额，防止并发退款导致余额变负
        if (rechargeType === 'refund') {
          const freshCustomer = await tx.marketingCustomer.findUnique({
            where: { id: dto.customerId },
            select: { balance: true },
          });
          if (
            !freshCustomer ||
            Money.fromDbCents(freshCustomer.balance).lessThan(totalMoney)
          ) {
            throw new BadRequestException('退款金额不能超过顾客当前余额');
          }
        }

        const recharge = await tx.marketingRecharge.create({
          data: {
            storeId,
            customerId: dto.customerId,
            amount: rechargeMoney.toDbCents(),
            giftAmount: giftMoney.toDbCents(),
            totalAmount: totalMoney.toDbCents(),
            type: rechargeType as never,
            promotionId: dto.promotionId ?? null,
            note: dto.note?.trim() || null,
          },
        });

        const balanceDelta =
          rechargeType === 'refund'
            ? totalMoney.negate().toDbCents()
            : totalMoney.toDbCents();

        await tx.marketingCustomer.update({
          where: { id: dto.customerId },
          data: { balance: { increment: balanceDelta } },
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

    return mapRechargeRow(row);
  }

  private async invalidateOverviewCache(storeId: number): Promise<void> {
    await this.cacheInvalidatorService.invalidateMarketingOverview(storeId);
  }
}
