import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CacheInvalidatorService } from '../../redis/invalidator';
import { RedisService } from '../../redis/redis.service';
import { buildMarketingCustomerDetailCacheKey } from '../../redis/cache-keys';
import { toNullableMediaText } from '../commerce/commerce.utils';
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
import { computeCustomerConsumptionStats } from './marketing-customer-consumption-stats.util';
import {
  lockMarketingCustomerRow,
  lockMarketingCustomerScope,
} from './marketing-write-locks.shared';

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

    const [finance, clubLevel, consumptionStats] = await Promise.all([
      computeCustomerFinance(this.prisma, customerId, customer.balance),
      this.marketingSharedService.resolveClubLevel(
        customer.storeId,
        customer.phone,
        customer.clubUserId,
      ),
      // F9: 详情页以 marketing_consumptions 实时聚合为准，覆盖物化字段
      computeCustomerConsumptionStats(this.prisma, customerId),
    ]);

    // 仅在消费表存在记录时才覆盖，避免孤儿 customer 被强制归零
    if (
      consumptionStats.visitCount > 0 ||
      consumptionStats.totalSpentCents !== 0
    ) {
      customer.totalSpent = consumptionStats.totalSpentCents;
      customer.visitCount = consumptionStats.visitCount;
      if (consumptionStats.lastVisitAt) {
        customer.lastVisitAt = consumptionStats.lastVisitAt;
      }
    }

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

    try {
      // 查重与建档必须处于同一把门店锁内：baseline 迁移已移除手机号部分
      // 唯一索引，P2002 不再兜底，锁外先查后写会建出重复档案。
      const created = await this.prisma.$transaction(
        async (tx) => {
          await lockMarketingCustomerScope(tx, storeId);
          await this.marketingSharedService.ensureUniquePhone(
            tx,
            storeId,
            normalizedPhone,
          );
          return tx.marketingCustomer.create({
            data: {
              storeId,
              name: dto.name.trim(),
              phone: normalizedPhone,
              avatar: toNullableMediaText(dto.avatar),
              remark: dto.remark?.trim() || null,
              tier: 'regular',
            },
          });
        },
        { timeout: TX_TIMEOUT_MEDIUM },
      );

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

    // undefined=不改，''=清除，其它=校验后归一化
    const nextPhone =
      dto.phone !== undefined
        ? this.marketingSharedService.validatePhoneOrThrow(dto.phone)
        : undefined;

    const previousPhone = normalizePhone(customer.phone);
    // 查重放到事务内（持锁后）执行，见下方 $transaction 内注释
    const phoneChanged =
      nextPhone !== undefined &&
      nextPhone !== null &&
      nextPhone !== previousPhone;

    // B8: 手机号变更时同步 Member.phone（见下方两个 nextPhone !== null 守卫）。
    // 传空串表示「清除营销档案手机号」，此时**不能**把 Member.phone 一并置空：
    // Club 侧 findAccessibleStores 正是按 Member.phone 匹配门店，置空会让该用户
    // 当场失去全部门店访问权（页面跳「暂无可访问门店」）。
    const phoneUpdate = nextPhone !== undefined ? { phone: nextPhone } : {};

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        // 改号与查重必须串行：先拿门店锁，再确认目标手机号未被占用，
        // 否则两个并发改号请求会同时通过查重并写入同一号码。
        await lockMarketingCustomerScope(tx, customer.storeId);
        if (phoneChanged) {
          await this.marketingSharedService.ensureUniquePhone(
            tx,
            customer.storeId,
            nextPhone,
            customerId,
          );
        }

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
        if (
          nextPhone !== undefined &&
          nextPhone !== null &&
          customer.memberId !== null
        ) {
          await tx.member.update({
            where: { id: customer.memberId },
            data: { phone: nextPhone },
          });
        }

        // member_id 是「可选、兼容历史数据」的列，Club 顾客档案通常为空，
        // 此时 Member 与顾客之间只剩「门店 + 手机号」这条弱关联。漏同步会让
        // findAccessibleStores 按 members.phone 匹配不到该顾客 —— C 端用户改完
        // 手机号后当场失去这家门店。定位口径与 ClubPhoneRebindService.rebindPhone 一致。
        if (
          nextPhone !== undefined &&
          nextPhone !== null &&
          customer.memberId === null &&
          previousPhone
        ) {
          // 只在「同店同号唯一命中」时按 id 同步：门店手机号本应唯一，但历史
          // 脏数据可能出现同号多条，updateMany 会把它们一并改写，放大影响面。
          const matchedMembers = await tx.member.findMany({
            where: {
              storeId: customer.storeId,
              phone: previousPhone,
              deletedAt: null,
            },
            select: { id: true },
            take: 2,
          });
          if (matchedMembers.length === 1) {
            await tx.member.update({
              where: { id: matchedMembers[0].id },
              data: { phone: nextPhone },
            });
          }
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

    // 校验与软删除必须在同一把行锁内完成：锁外先读余额再写 deletedAt 会留下
    // 「读到 0 → 并发充值 → 档案已删但余额有钱」的窗口。
    await this.prisma.$transaction(
      async (tx) => {
        const locked = await lockMarketingCustomerRow(tx, customerId);
        if (locked.balance !== 0 || locked.points !== 0) {
          throw new BadRequestException(
            '该顾客仍有余额或积分，无法删除；请先完成退款或清零操作',
          );
        }
        await tx.marketingCustomer.update({
          where: { id: customerId },
          data: { deletedAt: new Date() },
        });
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

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
    // 顾客列表 / 详情 / 概览 / club 快照与派生结论都由统一失效器一次 keyspace
    // 遍历清掉；再逐个 delByPattern 会把同两个模式多扫两遍。
    await Promise.all([
      this.cacheInvalidatorService.invalidateMarketingOverview(storeId),
      this.cacheInvalidatorService.invalidateMarketingCustomerDerived(storeId),
      // 会员中心的余额/积分/等级事实源同为 marketing_customers，建档、改档、
      // 删档都必须连带失效，否则会员列表/详情读数会陈旧到 TTL 自然过期
      this.cacheInvalidatorService.invalidateMembersDerived(storeId),
    ]);
  }
}
