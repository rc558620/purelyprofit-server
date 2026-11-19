import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CommerceAccessService } from '../../commerce/commerce-access.service';
import {
  buildPaginationMeta,
  resolvePagination,
  toNullableMediaText,
} from '../../commerce/commerce.utils';
import { PlatformMembershipAccessService } from '../../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type {
  CreateProductDto,
  ListProductOptionsQueryDto,
  ListProductsQueryDto,
  PaginatedProductsResponseDto,
  ProductOptionsResponseDto,
  ProductResponseDto,
  ScanOrderingStatusResponseDto,
  ToggleScanOrderingStatusDto,
  UpdateProductDto,
} from './dto/product.dto';
import {
  deriveProductProfit,
  ensureProductCategory,
  ensureUniqueProductCode,
  resolveProductCode,
  resolveUpdatedProductProfit,
  validateDerivedProfit,
} from './products.domain';
import { buildProductResponse } from './products.mapper';
import {
  createProductRecord,
  deleteProductRecord,
  findProductById,
  findProductScalarById,
  findProductStore,
  queryAllProducts,
  queryProductPage,
  updateProductRecord,
} from './products.query';
import { ProductsScanOrderingSyncService } from './products-scan-ordering-sync.service';
import type { ProductRecord } from './products.types';
import {
  buildCreateProductData,
  buildUpdateProductData,
  toProductListQueryInput,
  validateProductMoney,
} from './products-command.utils';

/** 商品写事务上限：一次编辑可能包含 5 组 × 20 选项的逐条增量写，留足余量 */
const PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS = 15_000;

@Injectable()
export class ProductsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
    private readonly commerceAccessService: CommerceAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly scanOrderingSyncService: ProductsScanOrderingSyncService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListProductsQueryDto,
  ): Promise<PaginatedProductsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'goods:view',
      '无权查看该门店商品',
    );
    const { page, skip, take } = resolvePagination(
      query.page,
      query.pageSize,
      this.configService.get<number>('app.defaultPageSize') ?? 20,
      this.configService.get<number>('app.maxPageSize') ?? 100,
    );

    if (storeId === null) {
      return {
        items: [],
        meta: buildPaginationMeta(0, page, take),
      };
    }

    const result = await queryProductPage(this.prisma, {
      storeId,
      query: toProductListQueryInput(query),
      skip,
      take,
    });

    return {
      items: result.items.map(buildProductResponse),
      meta: buildPaginationMeta(result.total, page, take),
    };
  }

  /**
   * 一次性返回门店全量商品（不分页）。
   *
   * 专供点单/录单「选择器」：客户端需要本地全量搜索与分类筛选，
   * 走分页接口会产生 ceil(total / pageSize) 次请求；这里单次返回，字段与列表一致。
   */
  async listOptions(
    user: AuthenticatedUser,
    query: ListProductOptionsQueryDto,
  ): Promise<ProductOptionsResponseDto> {
    const storeId = await this.commerceAccessService.resolveViewStoreId(
      user,
      query.storeId,
      'goods:view',
      '无权查看该门店商品',
    );

    if (storeId === null) {
      return { items: [] };
    }

    const products = await queryAllProducts(this.prisma, { storeId });

    return { items: products.map(buildProductResponse) };
  }

  async detail(
    user: AuthenticatedUser,
    productId: number,
  ): Promise<ProductResponseDto> {
    const product = await findProductById(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:view',
      '无权查看该门店商品',
    );

    return buildProductResponse(product);
  }

  async create(
    user: AuthenticatedUser,
    dto: CreateProductDto,
  ): Promise<ProductResponseDto> {
    const storeId = await this.commerceAccessService.resolveSingleStoreId(
      user,
      dto.storeId,
      'goods:create',
      '无权操作该门店商品',
    );

    // 规格为全业态能力：非餐饮门店同样可配置（追加点单 / 自助下单消费）
    if (dto.specGroups !== undefined) {
      this.scanOrderingSyncService.validateSpecificationGroups(dto.specGroups);
    }

    await this.platformMembershipAccessService.ensureProductQuotaAvailable(
      storeId,
    );

    // 服务端重算利润：不再信任 dto.profit，由 price 与 costPrice 推导
    const priceMoney = Money.fromInputYuan(dto.price);
    const costPriceMoney =
      dto.costPrice !== undefined && dto.costPrice !== null
        ? Money.fromInputYuan(dto.costPrice)
        : null;
    const profitMoney = deriveProductProfit(priceMoney, costPriceMoney);

    validateProductMoney(priceMoney, costPriceMoney);
    validateDerivedProfit(profitMoney);

    const categoryName = dto.category.trim();
    // 分类补全与编号冲突校验查的是两张表，互不依赖，并行后少一次串行往返
    const [category, code] = await Promise.all([
      ensureProductCategory(this.prisma, {
        storeId,
        categoryName,
      }),
      resolveProductCode(this.prisma, {
        storeId,
        code: dto.code,
      }),
    ]);

    // 商品与规格同事务：规格写失败时不能留下「商品已建、规格缺失」的半成品
    const { product, specificationsChanged } = await this.prisma.$transaction(
      async (tx) => {
        const created = await createProductRecord(
          tx,
          buildCreateProductData(
            dto,
            storeId,
            category?.id ?? null,
            code,
            profitMoney,
          ),
        );
        const changed =
          dto.specGroups !== undefined
            ? await this.scanOrderingSyncService.syncSpecifications(
                storeId,
                created.id,
                dto.specGroups,
                tx,
              )
            : false;
        return { product: created, specificationsChanged: changed };
      },
      { timeout: PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS },
    );

    // 缓存失效只能在事务提交后做：事务内清缓存会在回滚后留下空窗期
    if (specificationsChanged) {
      await this.scanOrderingSyncService.invalidateCache(storeId);
    }

    if (dto.specGroups !== undefined) {
      return this.buildResponseAfterSpecSync(specificationsChanged, product);
    }

    return buildProductResponse(product);
  }

  async update(
    user: AuthenticatedUser,
    productId: number,
    dto: UpdateProductDto,
  ): Promise<ProductResponseDto> {
    // 前置校验只用到 storeId / code / price / costPrice，改用标量快照避免拉取三层规格
    const product = await findProductScalarById(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:update',
      '无权操作该门店商品',
    );

    // 规格为全业态能力：非餐饮门店同样可配置（追加点单 / 自助下单消费）
    if (dto.specGroups !== undefined) {
      this.scanOrderingSyncService.validateSpecificationGroups(dto.specGroups);
    }

    // 服务端重算利润：合并 dto 与现有记录，推导最终 profit
    const { nextPrice, nextCostPrice, nextProfit } =
      resolveUpdatedProductProfit(product, dto);

    validateProductMoney(nextPrice, nextCostPrice);
    validateDerivedProfit(nextProfit);

    const nextCode = dto.code?.trim();
    const nextCategory = dto.category?.trim();

    // 编号冲突校验与分类补全查的是两张表，互不依赖，并行后少一次串行往返
    const [categoryRecord] = await Promise.all([
      nextCategory
        ? ensureProductCategory(this.prisma, {
            storeId: product.storeId,
            categoryName: nextCategory,
          })
        : Promise.resolve(undefined),
      nextCode && nextCode !== product.code
        ? ensureUniqueProductCode(this.prisma, {
            storeId: product.storeId,
            code: nextCode,
            excludeId: product.id,
          })
        : Promise.resolve(undefined),
    ]);

    // DTO 传了 code 字段时，nextCode 有值则写入（含与当前值相同时，用于清理尾部空格等脏数据）
    const resolvedCode = nextCode || undefined;

    // 确保 category 与 categoryId 同步：仅当 ensureProductCategory 返回有效分类时才写入
    // 如果 ensureProductCategory 返回 null（理论上对非空字符串不会发生），则跳过分类更新
    const resolvedCategoryUpdate =
      nextCategory && categoryRecord
        ? { category: nextCategory, categoryId: categoryRecord.id }
        : undefined;

    // 同步商品信息变更到关联的扫码菜单商品
    const menuCategory = nextCategory
      ? await this.scanOrderingSyncService.resolveCategory(
          product.storeId,
          nextCategory,
        )
      : null;
    const menuUpdates = {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(menuCategory ? { categoryId: menuCategory.id } : {}),
      ...(dto.price !== undefined
        ? { basePrice: Money.fromInputYuan(dto.price).toDbCents() }
        : {}),
      ...(dto.image !== undefined
        ? { imageUrl: toNullableMediaText(dto.image) ?? null }
        : {}),
    };

    // 商品标量、规格、扫码菜单同事务：任一写失败整体回滚，
    // 不再出现「商品已改价、顾客侧仍是旧价」或「规格写失败但商品已落库」。
    const { updated, specificationsChanged } = await this.prisma.$transaction(
      async (tx) => {
        const record = await updateProductRecord(
          tx,
          product.id,
          buildUpdateProductData(
            dto,
            resolvedCode,
            resolvedCategoryUpdate,
            nextProfit,
          ),
        );
        const changed =
          dto.specGroups !== undefined
            ? await this.scanOrderingSyncService.syncSpecifications(
                product.storeId,
                product.id,
                dto.specGroups,
                tx,
              )
            : false;
        await this.scanOrderingSyncService.syncProduct(
          product.storeId,
          product.id,
          menuUpdates,
          tx,
        );
        return { updated: record, specificationsChanged: changed };
      },
      { timeout: PRODUCT_WRITE_TRANSACTION_TIMEOUT_MS },
    );

    // 缓存失效只能在事务提交后做：事务内清缓存会在回滚后留下空窗期
    if (specificationsChanged || Object.keys(menuUpdates).length > 0) {
      await this.scanOrderingSyncService.invalidateCache(product.storeId);
    }

    return this.buildResponseAfterSpecSync(specificationsChanged, updated);
  }

  /**
   * 规格重建会让 specGroup / option 的 ID 漂移，必须重查一次才能回给前端正确的 ID；
   * 未变更时落库返回值已按 productSelect 带上规格快照，直接沿用即可，省掉一次带三层嵌套的重查。
   */
  private async buildResponseAfterSpecSync(
    specificationsChanged: boolean,
    product: ProductRecord,
  ): Promise<ProductResponseDto> {
    if (specificationsChanged) {
      const refreshed = await findProductById(this.prisma, product.id);
      if (refreshed) return buildProductResponse(refreshed);
    }

    return buildProductResponse(product);
  }

  async remove(user: AuthenticatedUser, productId: number): Promise<void> {
    const product = await findProductStore(this.prisma, productId);

    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:delete',
      '无权删除该门店商品',
    );

    await deleteProductRecord(this.prisma, product.id);

    // 商品删除时清理扫码菜单关联
    await this.scanOrderingSyncService.cleanup(product.storeId, product.id);
  }

  /**
   * 上架/下架到扫码点餐（仅餐饮门店）。
   *
   * enabled=true: 创建或恢复扫码菜单商品关联，同步普通商品基本信息。
   * enabled=false: 仅从扫码菜单下架，不删除普通商品。
   */
  async toggleScanOrderingStatus(
    user: AuthenticatedUser,
    productId: number,
    dto: ToggleScanOrderingStatusDto,
  ): Promise<ScanOrderingStatusResponseDto> {
    const product = await findProductScalarById(this.prisma, productId);
    if (!product) {
      throw new NotFoundException('商品不存在');
    }

    await this.commerceAccessService.ensureCanAccessStore(
      user,
      product.storeId,
      'goods:update',
      '无权操作该门店商品',
    );

    if (dto.enabled) {
      await this.scanOrderingSyncService.enable(product, dto.categoryId);
    } else {
      await this.scanOrderingSyncService.disable(product.storeId, productId);
    }

    // 失效扫码菜单缓存
    await this.scanOrderingSyncService.invalidateCache(product.storeId);

    return {
      id: String(productId),
      scanOrderingEnabled: dto.enabled,
    };
  }
}
