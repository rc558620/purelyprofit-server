import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import { Money } from '../../shared/money.utils';
import { CacheInvalidatorService } from '../../redis/invalidator';
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
} from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  calcCustomerTier,
  resolveMarketingPagination,
} from './marketing.utils';

@Injectable()
export class MarketingConsumptionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listConsumptions(
    user: AuthenticatedUser,
    customerId: number,
    query: { page?: number; pageSize?: number; storeId?: number },
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

    const balancePaid = dto.balancePaid ?? 0;
    const pointsDeducted = dto.pointsDeducted ?? 0;
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
    if (pointsDeducted > customer.points) {
      throw new BadRequestException('积分抵扣金额不能超过顾客当前积分');
    }
    if (
      Money.fromDbCents(balancePaid)
        .add(Money.fromDbCents(pointsDeducted))
        .greaterThan(Money.fromDbCents(dto.amount))
    ) {
      throw new BadRequestException('余额支付与积分抵扣之和不能超过消费金额');
    }

    const [consumptionRecord] = await this.prisma.$transaction(
      async (tx) => {
        const consumption = await tx.marketingConsumption.create({
          data: {
            storeId,
            customerId: dto.customerId,
            amount: dto.amount,
            balancePaid,
            pointsDeducted,
            payType: payType as never,
            itemsSummary: dto.itemsSummary?.trim() || null,
            promotionId: dto.promotionId ?? null,
          },
        });

        const newTotalSpent = Money.fromDbCents(customer.totalSpent)
          .add(Money.fromDbCents(dto.amount))
          .toDbCents();
        const newTier = calcCustomerTier(newTotalSpent) as never;

        await tx.marketingCustomer.update({
          where: { id: dto.customerId },
          data: {
            balance: { decrement: balancePaid },
            points: { decrement: pointsDeducted },
            totalSpent: { increment: dto.amount },
            visitCount: { increment: 1 },
            lastVisitAt: new Date(),
            tier: newTier,
          },
        });

        if (pointsDeducted > 0) {
          await tx.$executeRaw`
          INSERT INTO marketing_points_records (
            store_id,
            customer_id,
            amount,
            type,
            description
          )
          VALUES (
            ${storeId},
            ${dto.customerId},
            ${-pointsDeducted},
            ${'spend'}::"MarketingPointsChangeType",
            ${buildPointsSpendDescription(dto.itemsSummary)}
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
    await this.cacheInvalidatorService.invalidateMarketingOverview(storeId);
  }
}
