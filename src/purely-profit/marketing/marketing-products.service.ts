import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { Money } from '../../shared/money.utils';
import { PrismaService } from '../../prisma/prisma.service';
import {
  toNullableMediaText,
  toNullableText,
} from '../commerce/commerce.utils';
import type {
  CalculateTimingPriceDto,
  CalculateTimingPriceResponseDto,
  MarketingProductDto,
  MarketingProductsResponseDto,
} from './dto/marketing-product.response.dto';
import type {
  CreateMarketingProductDto,
  UpdateMarketingProductDto,
} from './dto/marketing-product.dto';
import type { ListMarketingProductsQueryDto } from './dto/marketing-product-query.dto';
import type { ToggleMarketingProductDto } from './dto/marketing-product-toggle.dto';
import {
  buildMarketingProductWhere,
  resolveMarketingProductOrderBy,
} from './marketing.domain';
import { mapProductRow } from './marketing.mapper';
import { MarketingSharedService } from './marketing-shared.service';
import type { MarketingProductRow } from './marketing.types';
import {
  MARKETING_PRODUCT_BILLING_MODE_VALUES,
  MARKETING_PRODUCT_TYPE_VALUES,
  resolveMarketingPagination,
  safeEnumCoerce,
  type MarketingProductBillingModeValue,
  type MarketingProductTypeValue,
} from './marketing.utils';

const MARKETING_PRODUCT_ROW_INCLUDE = {
  category: {
    select: {
      name: true,
    },
  },
} as const;

type MarketingProductRecord = Prisma.MarketingProductGetPayload<{
  include: typeof MARKETING_PRODUCT_ROW_INCLUDE;
}>;

/** 归一化后的团购券/开台计费配置（金额统一为「分」） */
interface NormalizedProductBilling {
  validDays: number | null;
  billingMode: MarketingProductBillingModeValue;
  hourlyRateCents: number | null;
  countdownMinutes: number | null;
  countdownPriceCents: number | null;
  autoCheckout: boolean;
}

@Injectable()
export class MarketingProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listProducts(
    user: AuthenticatedUser,
    query: ListMarketingProductsQueryDto,
  ): Promise<MarketingProductsResponseDto> {
    const resolvedStoreId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    if (!resolvedStoreId) {
      return {
        items: [],
        total: 0,
        page: query.page ?? 1,
        pageSize: query.pageSize ?? 20,
      };
    }

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );

    const [rows, total] = await Promise.all([
      this.prisma.marketingProduct.findMany({
        where: buildMarketingProductWhere({
          storeId: resolvedStoreId,
          categoryId: query.categoryId ?? undefined,
        }),
        include: MARKETING_PRODUCT_ROW_INCLUDE,
        orderBy: resolveMarketingProductOrderBy(query.sortBy),
        take,
        skip,
      }),
      this.prisma.marketingProduct.count({
        where: buildMarketingProductWhere({
          storeId: resolvedStoreId,
          categoryId: query.categoryId ?? undefined,
        }),
      }),
    ]);

    return {
      items: rows.map((row) => mapProductRow(this.toProductRow(row))),
      total,
      page,
      pageSize: take,
    };
  }

  async createProduct(
    user: AuthenticatedUser,
    storeId: number,
    dto: CreateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      storeId,
      'marketing:manage',
    );

    // B-1 fix: 新增产品时必须校验分类归属当前门店
    await this.ensureCategoryBelongsToStore(storeId, dto.categoryId);

    // B-3 fix: 划线价不得低于售价
    this.assertOriginalPriceNotLessThanPrice(dto.price, dto.originalPrice);

    const billing = this.normalizeBillingConfig({
      type: dto.type ?? 'service',
      billingMode: dto.billingMode ?? 'items',
      durationMinutes: dto.durationMinutes ?? null,
      validDays: dto.validDays ?? null,
      hourlyRate: dto.hourlyRate ?? null,
      countdownMinutes: dto.countdownMinutes ?? null,
      countdownPrice: dto.countdownPrice ?? null,
      autoCheckout: dto.autoCheckout ?? false,
    });

    try {
      const created = await this.prisma.marketingProduct.create({
        data: {
          storeId,
          categoryId: dto.categoryId,
          name: dto.name.trim(),
          price: Money.fromInputYuan(dto.price).toDbCents(),
          originalPrice:
            dto.originalPrice != null
              ? Money.fromInputYuan(dto.originalPrice).toDbCents()
              : null,
          image: toNullableMediaText(dto.image) ?? null,
          descriptionTitle: toNullableText(dto.descriptionTitle) ?? null,
          description: toNullableText(dto.description) ?? null,
          stock: dto.stock ?? 0,
          durationMinutes: dto.durationMinutes ?? null,
          personCount: dto.personCount ?? null,
          unit: dto.unit ?? null,
          type: dto.type ?? 'service',
          validDays: billing.validDays,
          billingMode: billing.billingMode,
          hourlyRate: billing.hourlyRateCents,
          countdownMinutes: billing.countdownMinutes,
          countdownPrice: billing.countdownPriceCents,
          autoCheckout: billing.autoCheckout,
        },
        include: MARKETING_PRODUCT_ROW_INCLUDE,
      });

      return mapProductRow(this.toProductRow(created));
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          // B-4 fix: 同门店同名产品唯一约束冲突
          throw new BadRequestException('该门店下已存在同名产品');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('产品分类不存在或不属于当前门店');
        }
      }
      throw error;
    }
  }

  async updateProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateMarketingProductDto,
  ): Promise<MarketingProductDto> {
    const product =
      await this.marketingSharedService.findProductOrThrow(productId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      product.storeId,
      'marketing:manage',
    );

    if (dto.categoryId != null) {
      await this.ensureCategoryBelongsToStore(product.storeId, dto.categoryId);
    }

    // B-3 fix: 合并已有值与本次更新值，校验划线价不得低于售价
    const effectivePriceYuan =
      dto.price != null
        ? dto.price
        : Money.fromDbCents(product.price).toOutputYuan();
    const effectiveOriginalYuan =
      dto.originalPrice !== undefined
        ? dto.originalPrice
        : product.originalPrice != null
          ? Money.fromDbCents(product.originalPrice).toOutputYuan()
          : null;
    this.assertOriginalPriceNotLessThanPrice(
      effectivePriceYuan,
      effectiveOriginalYuan,
    );

    const currentType = safeEnumCoerce(
      product.type,
      MARKETING_PRODUCT_TYPE_VALUES,
      'service',
    );
    const currentBillingMode = safeEnumCoerce(
      product.billingMode,
      MARKETING_PRODUCT_BILLING_MODE_VALUES,
      'items',
    );
    const toYuan = (cents: number | null): number | null =>
      cents != null ? Money.fromDbCents(cents).toOutputYuan() : null;

    // 合并已有值与本次更新值后归一化计费配置，
    // 保证「非团购券商品」与「倒计时」两条不变量在 PATCH 语义下同样成立
    const billing = this.normalizeBillingConfig({
      type: dto.type ?? currentType,
      billingMode: dto.billingMode ?? currentBillingMode,
      durationMinutes:
        dto.durationMinutes !== undefined
          ? (dto.durationMinutes ?? null)
          : product.durationMinutes,
      validDays:
        dto.validDays !== undefined
          ? (dto.validDays ?? null)
          : product.validDays,
      hourlyRate:
        dto.hourlyRate !== undefined
          ? (dto.hourlyRate ?? null)
          : toYuan(product.hourlyRate),
      countdownMinutes:
        dto.countdownMinutes !== undefined
          ? (dto.countdownMinutes ?? null)
          : product.countdownMinutes,
      countdownPrice:
        dto.countdownPrice !== undefined
          ? (dto.countdownPrice ?? null)
          : toYuan(product.countdownPrice),
      autoCheckout: dto.autoCheckout ?? product.autoCheckout,
    });

    // 构建更新数据，分离 undefined（不更新）与 null（清空）
    const data: Prisma.MarketingProductUncheckedUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name.trim();
    if (dto.categoryId != null) data.categoryId = dto.categoryId;
    if (dto.price != null)
      data.price = Money.fromInputYuan(dto.price).toDbCents();
    if (dto.originalPrice !== undefined)
      data.originalPrice =
        dto.originalPrice != null
          ? Money.fromInputYuan(dto.originalPrice).toDbCents()
          : null;
    if (dto.image !== undefined) data.image = toNullableMediaText(dto.image);
    if (dto.descriptionTitle !== undefined)
      data.descriptionTitle = toNullableText(dto.descriptionTitle);
    if (dto.description !== undefined)
      data.description = toNullableText(dto.description);
    if (dto.stock != null) data.stock = dto.stock;
    if (dto.durationMinutes !== undefined)
      data.durationMinutes = dto.durationMinutes ?? null;
    if (dto.personCount !== undefined)
      data.personCount = dto.personCount ?? null;
    if (dto.unit !== undefined) data.unit = dto.unit || null;
    if (dto.type !== undefined) data.type = dto.type;
    // 计费相关字段统一写入归一化结果（含脏数据清理），不再逐个判断 undefined
    data.validDays = billing.validDays;
    data.billingMode = billing.billingMode;
    data.hourlyRate = billing.hourlyRateCents;
    data.countdownMinutes = billing.countdownMinutes;
    data.countdownPrice = billing.countdownPriceCents;
    data.autoCheckout = billing.autoCheckout;

    let updated: MarketingProductRecord;
    try {
      updated = await this.prisma.marketingProduct.update({
        where: { id: productId },
        data,
        include: MARKETING_PRODUCT_ROW_INCLUDE,
      });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002') {
          // 与 createProduct 对齐：唯一约束冲突（含改名撞名）返回友好提示而非 500
          throw new BadRequestException('该门店下已存在同名产品');
        }
        if (error.code === 'P2003') {
          throw new BadRequestException('产品分类不存在或不属于当前门店');
        }
      }
      throw error;
    }

    return mapProductRow(this.toProductRow(updated));
  }

  async deleteProduct(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<void> {
    const product =
      await this.marketingSharedService.findProductOrThrow(productId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      product.storeId,
      'marketing:manage',
    );

    try {
      await this.prisma.marketingProduct.delete({ where: { id: productId } });
    } catch (error: unknown) {
      // B-5 fix: 被外键引用时返回友好提示而非 500
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2014' || error.code === 'P2003')
      ) {
        throw new BadRequestException('该产品已被其他业务引用，无法删除');
      }
      throw error;
    }
  }

  async toggleProduct(
    user: AuthenticatedUser,
    productId: number,
    dto: ToggleMarketingProductDto,
  ): Promise<MarketingProductDto> {
    const product =
      await this.marketingSharedService.findProductOrThrow(productId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      product.storeId,
      'marketing:manage',
    );

    const updated = await this.prisma.marketingProduct.update({
      where: { id: productId },
      data: { isActive: dto.isActive },
      include: MARKETING_PRODUCT_ROW_INCLUDE,
    });

    return mapProductRow(this.toProductRow(updated));
  }

  /**
   * 自动计算费率（金额计算权在后端，前端仅传参并展示结果）：
   * - per_session（倒计时台位费）：整次价格 = 售价（元/次），时长仅作必填校验
   * - per_hour（计时单价，默认）：售价（分）÷ 时长（分钟）× 60，四舍五入到分（元/小时）
   */
  calculateTimingPrice(
    dto: CalculateTimingPriceDto,
  ): CalculateTimingPriceResponseDto {
    if (dto.mode === 'per_session') {
      return {
        rate: Money.fromInputYuan(dto.price).toOutputYuan(),
      };
    }
    const priceCents = Money.fromInputYuan(dto.price).toDbCents();
    const rateCents = Math.round((priceCents * 60) / dto.durationMinutes);
    return {
      rate: Money.fromDbCents(rateCents).toOutputYuan(),
    };
  }

  /**
   * 归一化团购券 / 开台计费配置，补齐此前只存在于前端的两条约束：
   * 1. 非团购券商品一律清空 validDays 与开台计费字段：前端切换商品类型后
   *    隐藏字段值仍会保留并提交（useForm 有意保留 unmount 字段值），
   *    若不清洗会在 service 商品上留下脏的计费配置。
   * 2. 倒计时模式要求预设时长与服务时长非空且一致：开台计时以
   *    countdownMinutes 为准，与服务时长不符会导致计费账实不符。
   * @param input.type 生效的商品类型（更新场景需传入合并后的值）
   * @param input.hourlyRate / countdownPrice 单位「元」，输出统一为「分」
   */
  private normalizeBillingConfig(input: {
    type: MarketingProductTypeValue;
    billingMode: MarketingProductBillingModeValue;
    durationMinutes: number | null;
    validDays: number | null;
    hourlyRate: number | null;
    countdownMinutes: number | null;
    countdownPrice: number | null;
    autoCheckout: boolean;
  }): NormalizedProductBilling {
    const EMPTY_BILLING: NormalizedProductBilling = {
      validDays: null,
      billingMode: 'items',
      hourlyRateCents: null,
      countdownMinutes: null,
      countdownPriceCents: null,
      autoCheckout: false,
    };

    if (input.type !== 'voucher') {
      return EMPTY_BILLING;
    }

    const toCents = (yuan: number | null): number | null =>
      yuan != null ? Money.fromInputYuan(yuan).toDbCents() : null;

    const normalized: NormalizedProductBilling = {
      validDays: input.validDays,
      billingMode: input.billingMode,
      hourlyRateCents: toCents(input.hourlyRate),
      countdownMinutes: input.countdownMinutes,
      countdownPriceCents: toCents(input.countdownPrice),
      autoCheckout: input.autoCheckout,
    };

    // 按计费方式保留对应字段、清空其它计费方式的专属字段，
    // 避免前端切换计费方式后隐藏字段的残留值写库
    const keepTimed = (
      mode: MarketingProductBillingModeValue,
    ): mode is 'timed' | 'mixed' => mode === 'timed' || mode === 'mixed';

    if (normalized.billingMode === 'countdown') {
      if (normalized.countdownMinutes == null) {
        throw new BadRequestException('请填写预设时长');
      }
      if (input.durationMinutes == null) {
        throw new BadRequestException('请填写服务时长');
      }
      if (normalized.countdownMinutes !== input.durationMinutes) {
        throw new BadRequestException('预设时长与服务时长不一致，请保持一致');
      }
      return { ...normalized, hourlyRateCents: null };
    }

    if (keepTimed(normalized.billingMode)) {
      return {
        ...normalized,
        countdownMinutes: null,
        countdownPriceCents: null,
        autoCheckout: false,
      };
    }

    // items（纯消费）：无需任何开台计费参数，但保留团购券有效天数
    return {
      ...normalized,
      hourlyRateCents: null,
      countdownMinutes: null,
      countdownPriceCents: null,
      autoCheckout: false,
    };
  }

  private assertOriginalPriceNotLessThanPrice(
    priceYuan: number,
    originalPriceYuan: number | null | undefined,
  ): void {
    if (originalPriceYuan == null) return;
    const priceCents = Money.fromInputYuan(priceYuan).toDbCents();
    const originalCents = Money.fromInputYuan(originalPriceYuan).toDbCents();
    if (originalCents < priceCents) {
      throw new BadRequestException('划线价不能低于售价');
    }
  }

  private async ensureCategoryBelongsToStore(
    storeId: number,
    categoryId: number,
  ): Promise<void> {
    const category =
      await this.marketingSharedService.findProductCategoryOrThrow(categoryId);
    if (category.storeId !== storeId) {
      throw new BadRequestException('产品分类不属于当前门店');
    }
  }

  private toProductRow(
    row: Exclude<MarketingProductRecord, null>,
  ): MarketingProductRow {
    return {
      id: row.id,
      storeId: row.storeId,
      categoryId: row.categoryId,
      categoryName: row.category?.name ?? '',
      name: row.name,
      price: row.price,
      originalPrice: row.originalPrice,
      image: row.image,
      descriptionTitle: row.descriptionTitle,
      description: row.description,
      stock: row.stock,
      durationMinutes: row.durationMinutes,
      personCount: row.personCount,
      unit: row.unit,
      type: row.type,
      validDays: row.validDays,
      billingMode: row.billingMode,
      hourlyRate: row.hourlyRate,
      countdownMinutes: row.countdownMinutes,
      countdownPrice: row.countdownPrice,
      autoCheckout: row.autoCheckout,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }
}
