import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';
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
  ) {}

  async listRecharges(
    user: AuthenticatedUser,
    query: ListRechargesQueryDto & { storeId?: number },
  ): Promise<MarketingRechargesResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return {
        items: [],
        meta: buildMarketingPaginationMeta(0, 1, query.pageSize ?? 20),
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
    const giftAmount = dto.giftAmount ?? 0;
    const totalIn = dto.amount + giftAmount;

    if (rechargeType === 'refund' && customer.balance < dto.amount) {
      throw new BadRequestException('退款金额不能超过顾客当前余额');
    }

    const [rechargeRecord] = await this.prisma.$transaction(async (tx) => {
      const recharge = await tx.marketingRecharge.create({
        data: {
          storeId,
          customerId: dto.customerId,
          amount: dto.amount,
          giftAmount,
          type: rechargeType as never,
          promotionId: dto.promotionId ?? null,
          note: dto.note?.trim() || null,
        },
      });

      const balanceDelta = rechargeType === 'refund' ? -dto.amount : totalIn;

      await tx.marketingCustomer.update({
        where: { id: dto.customerId },
        data: { balance: { increment: balanceDelta } },
      });

      if (dto.promotionId) {
        await tx.marketingPromotion.updateMany({
          where: { id: dto.promotionId, storeId },
          data: { usageCount: { increment: 1 } },
        });
      }

      return [recharge] as const;
    });

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
