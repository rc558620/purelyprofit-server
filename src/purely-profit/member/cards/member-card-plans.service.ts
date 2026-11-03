// 商家端会员卡模板业务：列表 / 新增 / 编辑 / 上下架
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, type MemberCardPlan } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MarketingSharedService } from '../../marketing/marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from '../../marketing/marketing.utils';
import type {
  CreateMemberCardPlanDto,
  UpdateMemberCardPlanDto,
} from './dto/member-card-plan.dto';
import type { ListMemberCardPlansQueryDto } from './dto/member-card-plan-query.dto';
import type { ToggleMemberCardPlanDto } from './dto/member-card-plan-toggle.dto';
import type {
  MemberCardPlanDto,
  MemberCardPlansResponseDto,
} from './dto/member-card-plan.response.dto';
import {
  assertOriginalPriceNotLessThanPrice,
  throwOnPlanWriteError,
} from './member-card-plan.errors';
import {
  mapMemberCardPlan,
  type MemberCardPlanAggregates,
} from './member-card-plan.mapper';
import {
  MEMBER_CARD_TIMES_KIND,
  type MemberCardKindValue,
} from './member-card-plan.constants';

/**
 * 卡模板编排层。
 *
 * 口径约定：
 * - 金额：DTO 入参为元，落库统一转分，出参再转回元（Money 是唯一换算入口）；
 * - 归属：模板属于门店，写操作按模板自身 storeId 做权限校验，不信任前端透传；
 * - 软删除：查询一律带 deletedAt: null，本模块不提供物理删除；
 * - 派生字段：soldCount / marketingProductId 不落库，读时按订单与商品反查回填。
 */
@Injectable()
export class MemberCardPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listPlans(
    user: AuthenticatedUser,
    query: ListMemberCardPlansQueryDto,
  ): Promise<MemberCardPlansResponseDto> {
    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const storeId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );

    if (storeId === null) {
      return { items: [], ...buildMarketingPaginationMeta(0, page, take) };
    }

    const where = this.buildListWhere(storeId, query);
    const [rows, total] = await Promise.all([
      this.prisma.memberCardPlan.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.memberCardPlan.count({ where }),
    ]);

    const aggregates = await this.resolveAggregates(
      storeId,
      rows.map((row) => row.id),
    );

    return {
      items: rows.map((row) =>
        mapMemberCardPlan(row, aggregates.get(row.id) ?? {}),
      ),
      ...buildMarketingPaginationMeta(total, page, take),
    };
  }

  async createPlan(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMemberCardPlanDto,
  ): Promise<MemberCardPlanDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    const name = dto.name.trim();
    const priceFen = Money.fromInputYuan(dto.price).toDbCents();
    const originalPriceFen = this.resolveOriginalPriceFen(dto.originalPrice);
    assertOriginalPriceNotLessThanPrice(priceFen, originalPriceFen);
    await this.ensureNameAvailable(storeId, name);

    const created = await this.runPlanWrite(() =>
      this.prisma.memberCardPlan.create({
        data: {
          storeId,
          name,
          kind: dto.kind,
          price: priceFen,
          originalPrice: originalPriceFen,
          validDays: dto.validDays,
          totalTimes: this.resolveCreatedTotalTimes(dto),
          perUseTimes: dto.perUseTimes ?? 1,
          usableSpaceTypes: dto.usableSpaceTypes ?? [],
          usableWeekdays: dto.usableWeekdays ?? [],
          maxGuestPerUse: dto.maxGuestPerUse ?? null,
          purchaseLimit: dto.purchaseLimit ?? null,
          isActive: dto.isActive ?? true,
        },
      }),
    );

    return this.toPlanDto(created);
  }

  async updatePlan(
    user: AuthenticatedUser,
    planId: number,
    dto: UpdateMemberCardPlanDto,
  ): Promise<MemberCardPlanDto> {
    const plan = await this.findPlanOrThrow(planId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      plan.storeId,
      'marketing:manage',
    );

    const name = dto.name?.trim();
    if (name !== undefined && name !== plan.name) {
      await this.ensureNameAvailable(plan.storeId, name, plan.id);
    }

    const updated = await this.runPlanWrite(() =>
      this.prisma.memberCardPlan.update({
        where: { id: plan.id },
        data: this.buildUpdateData(plan, dto),
      }),
    );

    return this.toPlanDto(updated);
  }

  async togglePlan(
    user: AuthenticatedUser,
    planId: number,
    dto: ToggleMemberCardPlanDto,
  ): Promise<MemberCardPlanDto> {
    const plan = await this.findPlanOrThrow(planId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      plan.storeId,
      'marketing:manage',
    );

    const updated = await this.runPlanWrite(() =>
      this.prisma.memberCardPlan.update({
        where: { id: plan.id },
        data: { isActive: dto.isActive },
      }),
    );

    return this.toPlanDto(updated);
  }

  private buildListWhere(
    storeId: number,
    query: ListMemberCardPlansQueryDto,
  ): Prisma.MemberCardPlanWhereInput {
    const keyword = query.keyword?.trim();

    return {
      storeId,
      deletedAt: null,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(keyword ? { name: { contains: keyword, mode: 'insensitive' } } : {}),
    };
  }

  /**
   * 局部更新数据：未下发字段保持原值，显式下发 null 表示清空。
   * 卡类型切换时同步校正 totalTimes，避免出现「时长卡带总次数」的脏数据。
   */
  private buildUpdateData(
    plan: MemberCardPlan,
    dto: UpdateMemberCardPlanDto,
  ): Prisma.MemberCardPlanUpdateInput {
    const kind = dto.kind ?? plan.kind;
    const priceFen =
      dto.price === undefined
        ? plan.price
        : Money.fromInputYuan(dto.price).toDbCents();
    const originalPriceFen =
      dto.originalPrice === undefined
        ? plan.originalPrice
        : this.resolveOriginalPriceFen(dto.originalPrice);
    assertOriginalPriceNotLessThanPrice(priceFen, originalPriceFen);

    const name = dto.name?.trim();

    return {
      ...(name !== undefined ? { name } : {}),
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}),
      price: priceFen,
      originalPrice: originalPriceFen,
      ...(dto.validDays !== undefined ? { validDays: dto.validDays } : {}),
      totalTimes: this.resolveUpdatedTotalTimes(
        kind,
        dto.totalTimes,
        plan.totalTimes,
      ),
      ...(dto.perUseTimes !== undefined
        ? { perUseTimes: dto.perUseTimes }
        : {}),
      ...(dto.usableSpaceTypes !== undefined
        ? { usableSpaceTypes: dto.usableSpaceTypes }
        : {}),
      ...(dto.usableWeekdays !== undefined
        ? { usableWeekdays: dto.usableWeekdays }
        : {}),
      ...(dto.maxGuestPerUse !== undefined
        ? { maxGuestPerUse: dto.maxGuestPerUse }
        : {}),
      ...(dto.purchaseLimit !== undefined
        ? { purchaseLimit: dto.purchaseLimit }
        : {}),
      ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
    };
  }

  /**
   * 派生聚合回填：soldCount 取已支付售卡订单的数量合计，
   * marketingProductId 由 marketing_products.cardPlanId 反查（卡模板侧无该列）。
   */
  private async resolveAggregates(
    storeId: number,
    planIds: number[],
  ): Promise<Map<number, MemberCardPlanAggregates>> {
    const aggregates = new Map<number, MemberCardPlanAggregates>();
    if (planIds.length === 0) {
      return aggregates;
    }

    const [orderGroups, products] = await Promise.all([
      this.prisma.memberCardOrder.groupBy({
        by: ['planId'],
        where: { storeId, planId: { in: planIds }, status: 'paid' },
        _sum: { quantity: true },
      }),
      this.prisma.marketingProduct.findMany({
        where: { storeId, cardPlanId: { in: planIds } },
        select: { id: true, cardPlanId: true },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      }),
    ]);

    orderGroups.forEach((group) => {
      aggregates.set(group.planId, { soldCount: group._sum.quantity ?? 0 });
    });

    products.forEach((product) => {
      if (product.cardPlanId === null) {
        return;
      }
      const current = aggregates.get(product.cardPlanId) ?? {};
      // 正常数据下 1 个模板只挂 1 个商品；异常数据按最近更新的为准
      if (current.marketingProductId !== undefined) {
        return;
      }
      aggregates.set(product.cardPlanId, {
        ...current,
        marketingProductId: String(product.id),
      });
    });

    return aggregates;
  }

  private async toPlanDto(plan: MemberCardPlan): Promise<MemberCardPlanDto> {
    const aggregates = await this.resolveAggregates(plan.storeId, [plan.id]);
    return mapMemberCardPlan(plan, aggregates.get(plan.id) ?? {});
  }

  private async findPlanOrThrow(planId: number): Promise<MemberCardPlan> {
    const plan = await this.prisma.memberCardPlan.findFirst({
      where: { id: planId, deletedAt: null },
    });
    if (!plan) {
      throw new NotFoundException('会员卡模板不存在');
    }

    return plan;
  }

  /** 同门店未删除模板名唯一：先查一次给出友好冲突，并发场景由 P2002 兜底 */
  private async ensureNameAvailable(
    storeId: number,
    name: string,
    excludePlanId?: number,
  ): Promise<void> {
    const duplicate = await this.prisma.memberCardPlan.findFirst({
      where: {
        storeId,
        name,
        deletedAt: null,
        ...(excludePlanId !== undefined ? { id: { not: excludePlanId } } : {}),
      },
      select: { id: true },
    });
    if (duplicate) {
      throw new ConflictException('同一门店下已存在同名会员卡模板');
    }
  }

  private resolveCreatedTotalTimes(
    dto: CreateMemberCardPlanDto,
  ): number | null {
    if (dto.kind === MEMBER_CARD_TIMES_KIND) {
      if (dto.totalTimes === undefined || dto.totalTimes === null) {
        throw new BadRequestException('次数卡必须填写总次数');
      }
      return dto.totalTimes;
    }

    if (dto.totalTimes !== undefined && dto.totalTimes !== null) {
      throw new BadRequestException('时长卡不支持填写总次数，请改用次数卡类型');
    }

    return null;
  }

  private resolveUpdatedTotalTimes(
    kind: MemberCardKindValue,
    next: number | null | undefined,
    current: number | null,
  ): number | null {
    if (kind === MEMBER_CARD_TIMES_KIND) {
      const totalTimes = next === undefined ? current : next;
      if (totalTimes === null) {
        throw new BadRequestException('次数卡必须填写总次数');
      }
      return totalTimes;
    }

    if (next !== undefined && next !== null) {
      throw new BadRequestException('时长卡不支持填写总次数，请改用次数卡类型');
    }

    return null;
  }

  private resolveOriginalPriceFen(
    originalPrice?: number | null,
  ): number | null {
    if (originalPrice === undefined || originalPrice === null) {
      return null;
    }

    return Money.fromInputYuan(originalPrice).toDbCents();
  }

  /** 写操作统一错误出口：把 Prisma 约束错误归一化为业务异常 */
  private async runPlanWrite<T>(action: () => Promise<T>): Promise<T> {
    try {
      return await action();
    } catch (error: unknown) {
      throwOnPlanWriteError(error);
    }
  }
}
