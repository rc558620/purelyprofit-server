import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import {
  buildMarketingCustomersListPattern,
  buildMarketingCustomerDetailCacheKey,
  buildMarketingCustomerDetailPattern,
} from '../../redis/cache-keys';
import { toNullableMediaText } from '../commerce/commerce.utils';
import { Money } from '../../shared/money.utils';
import type {
  AdjustCustomerPointsDto,
  CreateCustomerDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/marketing-query.dto';
import type {
  MarketingCustomerDetailDto,
  MarketingCustomerDto,
  MarketingCustomersResponseDto,
} from './dto/marketing-response.dto';
import { mapCustomerRow } from './marketing.mapper';
import { queryCustomerRowById } from './marketing.query';
import { MarketingSharedService } from './marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  normalizePhone,
  resolveMarketingPagination,
} from './marketing.utils';
import { MarketingCustomerListService } from './marketing-customer-list.service';
import { MarketingCustomerPointsService } from './marketing-customer-points.service';
import { computeCustomerFinance } from './marketing-customer-finance.utils';

// F8: 顾客详情缓存 TTL（15 秒，短于列表 60s，避免过度延迟）
const MARKETING_CUSTOMER_DETAIL_CACHE_TTL_SECONDS = 15;

@Injectable()
export class MarketingCustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
    private readonly marketingSharedService: MarketingSharedService,
    private readonly customerListService: MarketingCustomerListService,
    private readonly customerPointsService: MarketingCustomerPointsService,
  ) {}

  async listCustomers(
    user: AuthenticatedUser,
    query: ListCustomersQueryDto,
  ): Promise<MarketingCustomersResponseDto> {
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

    return this.customerListService.listCustomers(resolvedStoreId, query);
  }

  async getCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<MarketingCustomerDetailDto> {
    // B10: 先查询，再鉴权，统一返回 404，防止通过 403/404 区分存在性
    let customer = await queryCustomerRowById(this.prisma, customerId);
    if (customer) {
      try {
        await this.marketingSharedService.ensureMarketingStoreAccess(
          user,
          customer.storeId,
          'marketing:view',
        );
      } catch {
        customer = null;
      }
    }
    if (!customer) {
      throw new NotFoundException('顾客不存在');
    }

    // F8: 顾客详情短期缓存，避免高频重复聚合计算
    const detailCacheKey = buildMarketingCustomerDetailCacheKey(
      customer.storeId,
      customerId,
    );
    const cached =
      await this.redisService.getJson<MarketingCustomerDetailDto>(
        detailCacheKey,
      );
    if (cached) {
      return cached;
    }

    const [finance, clubLevel] = await Promise.all([
      computeCustomerFinance(this.prisma, customerId, customer.balance),
      this.marketingSharedService.resolveClubLevel(
        customer.storeId,
        customer.phone,
      ),
    ]);

    const result = {
      ...mapCustomerRow(customer),
      ...clubLevel,
      ...finance,
    };

    // F8: 写入短期缓存
    await this.redisService.setJson(
      detailCacheKey,
      result,
      MARKETING_CUSTOMER_DETAIL_CACHE_TTL_SECONDS,
    );

    return result;
  }

  async createCustomer(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    const normalizedPhone = this.marketingSharedService.validatePhoneOrThrow(
      dto.phone,
    );
    await this.marketingSharedService.ensureUniquePhone(
      storeId,
      normalizedPhone,
    );

    try {
      const created = await this.prisma.marketingCustomer.create({
        data: {
          storeId,
          name: dto.name.trim(),
          phone: normalizedPhone,
          avatar: toNullableMediaText(dto.avatar),
          remark: dto.remark?.trim() || null,
          tier: 'regular',
        },
      });

      await this.invalidateOverviewCache(storeId);

      return mapCustomerRow(created);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('该手机号的顾客已存在');
      }
      throw error;
    }
  }

  async updateCustomer(
    user: AuthenticatedUser,
    customerId: number,
    dto: UpdateCustomerDto,
  ): Promise<MarketingCustomerDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    if (dto.phone !== undefined) {
      const normalizedNewPhone =
        this.marketingSharedService.validatePhoneOrThrow(dto.phone);
      if (normalizedNewPhone !== normalizePhone(customer.phone)) {
        await this.marketingSharedService.ensureUniquePhone(
          customer.storeId,
          normalizedNewPhone,
          customerId,
        );
      }
    }

    // B8: 手机号变更时，同步更新关联的 Member.phone
    const phoneUpdate =
      dto.phone !== undefined
        ? { phone: this.marketingSharedService.validatePhoneOrThrow(dto.phone) }
        : {};

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        const result = await tx.marketingCustomer.update({
          where: { id: customerId },
          data: {
            ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
            ...phoneUpdate,
            ...(dto.avatar !== undefined
              ? { avatar: toNullableMediaText(dto.avatar) }
              : {}),
            ...(dto.remark !== undefined
              ? { remark: dto.remark.trim() || null }
              : {}),
          },
        });

        // B8: 若手机号变更且有关联 Member，同步更新 Member.phone
        if (dto.phone !== undefined && customer.memberId !== null) {
          await tx.member.update({
            where: { id: customer.memberId },
            data: {
              phone: this.marketingSharedService.validatePhoneOrThrow(
                dto.phone,
              ),
            },
          });
        }

        return result;
      });

      await this.invalidateOverviewCache(customer.storeId);

      return mapCustomerRow(updated);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        (error as { code: string }).code === 'P2002'
      ) {
        throw new ConflictException('该手机号的顾客已存在');
      }
      throw error;
    }
  }

  async deleteCustomer(
    user: AuthenticatedUser,
    customerId: number,
  ): Promise<void> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    if (
      Money.fromDbCents(customer.balance).isPositive() ||
      customer.points > 0
    ) {
      throw new BadRequestException(
        '该顾客仍有余额或积分，无法删除；请先完成退款或清零操作',
      );
    }

    await this.prisma.marketingCustomer.update({
      where: { id: customerId },
      data: { deletedAt: new Date() },
    });
    await this.invalidateOverviewCache(customer.storeId);
  }

  async adjustCustomerPoints(
    user: AuthenticatedUser,
    customerId: number,
    dto: AdjustCustomerPointsDto,
  ): Promise<MarketingCustomerDto> {
    const customer =
      await this.marketingSharedService.findCustomerOrThrow(customerId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      customer.storeId,
      'marketing:manage',
    );

    return this.customerPointsService.adjustCustomerPoints(
      customer,
      customerId,
      dto,
    );
  }

  private async invalidateOverviewCache(storeId: number): Promise<void> {
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      this.redisService.delByPattern(
        buildMarketingCustomersListPattern(storeId),
      ),
      // F8: 同步失效顾客详情缓存
      this.redisService.delByPattern(
        buildMarketingCustomerDetailPattern(storeId),
      ),
    ]);
  }
}
