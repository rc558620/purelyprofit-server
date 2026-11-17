import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import {
  buildClubMenuPattern,
  buildClubMenuVersionCacheKey,
} from '../../../redis/keys/club-cache-keys';
import { Money } from '../../../shared/money.utils';
import type { ProductSpecGroupDto } from './dto/product.dto';
import type { ProductScalarRecord } from './products.types';
import {
  hasSameProductSpecifications,
  validateProductSpecificationGroups,
} from './products-scan-ordering-spec.shared';

@Injectable()
export class ProductsScanOrderingSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  validateSpecificationGroups(groups: ProductSpecGroupDto[]): void {
    validateProductSpecificationGroups(groups);
  }

  /**
   * 同步规格组，返回规格是否真的被重建。
   *
   * 返回值供调用方判断要不要重查商品：create/update 的返回值里已经带上规格快照，
   * 只有真的重建过规格才需要再查一次，未变更时省掉一次带三层嵌套的重查。
   */
  async syncSpecifications(
    storeId: number,
    productId: number,
    groups: ProductSpecGroupDto[],
  ): Promise<boolean> {
    const existingMenuProduct = await this.findMenuProduct(storeId, productId);
    // 空规格短路：全业态放开规格配置后，未配置规格的商品（含每次编辑保存）不得
    // 凭空生成幽灵宿主，否则非餐饮门店每次编辑商品都会静默多出一条菜单商品记录。
    if (groups.length === 0 && !existingMenuProduct) return false;
    const menuProduct =
      existingMenuProduct ??
      (await this.createGhostMenuProduct(storeId, productId));
    let specificationsChanged = false;
    await this.prisma.$transaction(async (tx) => {
      // 无变更则不重建：规格组/选项当前是「物理删除后重建」，选项 ID 会漂移，
      // 历史订单退款时按 specOptionId 恢复规格库存就会静默丢失（风险 #5）。
      // 内容完全一致时直接跳过，避免无谓的 ID 漂移。
      const currentGroups = await tx.scanOrderingSpecGroup.findMany({
        where: { menuProductId: menuProduct.id },
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: {
          name: true,
          selectionType: true,
          minSelections: true,
          maxSelections: true,
          sortOrder: true,
          options: {
            orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
            select: {
              name: true,
              extraPrice: true,
              isDefault: true,
              isActive: true,
              sortOrder: true,
            },
          },
        },
      });
      if (hasSameProductSpecifications(currentGroups, groups)) return;

      specificationsChanged = true;

      await tx.scanOrderingSpecOption.deleteMany({
        where: { group: { menuProductId: menuProduct.id } },
      });
      await tx.scanOrderingSpecGroup.deleteMany({
        where: { menuProductId: menuProduct.id },
      });
      if (groups.length === 0) return;
      // 按 sort 显式升序：下面靠「位置下标」把选项挂回规格组，
      // 若入参数组顺序与落库后的排序不一致，选项会被写到别的规格组下。
      const sortedGroups = [...groups].sort(
        (left, right) => left.sort - right.sort,
      );
      await tx.scanOrderingSpecGroup.createMany({
        data: sortedGroups.map((group) => ({
          menuProductId: menuProduct.id,
          name: group.name.trim(),
          selectionType: group.selectMode === 'multi' ? 'multiple' : 'single',
          minSelections: group.minSelect,
          // null 表示不限选，直接保留；不要回退为选项数量，否则“多选不限”会被误限。
          maxSelections: group.maxSelect,
          sortOrder: group.sort,
        })),
      });
      const dbGroups = await tx.scanOrderingSpecGroup.findMany({
        where: { menuProductId: menuProduct.id },
        // id 次级排序：sortOrder 重复（历史脏数据）时保证顺序确定，
        // 否则 dbGroups[groupIndex] 可能指向另一个规格组。
        orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      await tx.scanOrderingSpecOption.createMany({
        data: sortedGroups.flatMap((group, groupIndex) =>
          group.options.map((option, optionIndex) => ({
            groupId: dbGroups[groupIndex].id,
            name: option.name.trim(),
            extraPrice: Money.fromInputYuan(option.priceDelta).toDbCents(),
            sortOrder: optionIndex,
            isDefault: option.isDefault,
            isActive: option.isActive,
          })),
        ),
      });
    });
    await this.invalidateCache(storeId);
    return specificationsChanged;
  }

  /** 上架只依赖商品标量快照；完整规格由菜单商品自身承载，这里无需读取 */
  async enable(
    product: ProductScalarRecord,
    categoryId?: number,
  ): Promise<void> {
    // 「查已有宿主」与「解析分类」互不依赖，并行后少一次串行往返
    const [existing, resolvedCategoryId] = await Promise.all([
      this.findMenuProduct(product.storeId, product.id),
      this.resolveMenuCategoryId(product, categoryId),
    ]);

    if (existing) {
      await this.prisma.scanOrderingMenuProduct.update({
        where: { id: existing.id },
        data: {
          isActive: true,
          deletedAt: null,
          categoryId: resolvedCategoryId,
          name: product.name,
          basePrice: product.price,
        },
      });
      return;
    }

    await this.createEnabledMenuProduct(product, resolvedCategoryId);
  }

  private async resolveMenuCategoryId(
    product: ProductScalarRecord,
    categoryId?: number,
  ): Promise<number> {
    if (categoryId !== undefined) return categoryId;
    const resolved = await this.resolveCategory(
      product.storeId,
      product.category,
    );
    return resolved.id;
  }

  private async createEnabledMenuProduct(
    product: ProductScalarRecord,
    categoryId: number,
  ): Promise<void> {
    // 分类存在性校验与同名冲突查询互不依赖，并行后少一次串行往返
    const [category, conflict] = await Promise.all([
      this.prisma.scanOrderingMenuCategory.findFirst({
        where: {
          id: categoryId,
          storeId: product.storeId,
          deletedAt: null,
        },
      }),
      this.prisma.scanOrderingMenuProduct.findFirst({
        where: {
          storeId: product.storeId,
          name: product.name,
          deletedAt: null,
        },
        select: { id: true, productId: true },
      }),
    ]);

    if (!category) throw new BadRequestException('扫码菜单分类不存在');
    if (conflict && conflict.productId !== product.id)
      throw new ConflictException('同一门店的扫码菜单商品名称不能重复');

    if (conflict) {
      await this.prisma.scanOrderingMenuProduct.update({
        where: { id: conflict.id },
        data: {
          productId: product.id,
          categoryId,
          imageUrl: product.image,
          basePrice: product.price,
          isActive: true,
        },
      });
      return;
    }

    await this.prisma.scanOrderingMenuProduct.create({
      data: {
        storeId: product.storeId,
        productId: product.id,
        categoryId,
        name: product.name,
        imageUrl: product.image,
        basePrice: product.price,
        isActive: true,
      },
    });
  }

  async disable(storeId: number, productId: number): Promise<void> {
    await this.prisma.scanOrderingMenuProduct.updateMany({
      where: { storeId, productId, deletedAt: null },
      data: { isActive: false },
    });
  }
  async cleanup(storeId: number, productId: number): Promise<void> {
    try {
      await this.prisma.scanOrderingMenuProduct.updateMany({
        where: { storeId, productId, deletedAt: null },
        data: { isActive: false, deletedAt: new Date() },
      });
      await this.invalidateCache(storeId);
    } catch {
      return;
    }
  }
  async syncProduct(
    storeId: number,
    productId: number,
    updates: {
      name?: string;
      categoryId?: number;
      basePrice?: number;
      imageUrl?: string | null;
    },
  ): Promise<void> {
    if (Object.keys(updates).length === 0) return;
    try {
      await this.prisma.scanOrderingMenuProduct.updateMany({
        where: { storeId, productId, deletedAt: null },
        data: updates,
      });
      await this.invalidateCache(storeId);
    } catch {
      return;
    }
  }

  /**
   * 查找商品已挂载的扫码菜单商品（规格宿主）；不存在返回 null，绝不创建。
   *
   * `orderBy: { id: 'asc' }` 必须与读侧（`products.query.ts` 取 `[0]`）口径一致：
   * 唯一索引 `uq_scan_ordering_menu_product_store_product_active` 保证了
   * 「同门店 + 同商品」最多只有一条未删除宿主，所以当前不会取错；
   * 这里显式排序是为了不依赖约束——一旦约束放宽或出现历史脏数据，
   * 写侧与读侧仍会指向同一条记录，避免规格写到非预期宿主上（风险 #6）。
   */
  private async findMenuProduct(
    storeId: number,
    productId: number,
  ): Promise<{ id: number } | null> {
    return this.prisma.scanOrderingMenuProduct.findFirst({
      where: { storeId, productId, deletedAt: null },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
  }

  /**
   * 创建「幽灵宿主」：仅作规格容器存在的扫码菜单商品（isActive=false）。
   * 非餐饮门店不会上架扫码点餐，该记录只承载 specGroups；
   * scanOrderingEnabled 判定要求 isActive=true，因此它不会让商品误显示为已上架。
   */
  private async createGhostMenuProduct(
    storeId: number,
    productId: number,
  ): Promise<{ id: number }> {
    const product = await this.prisma.product.findUnique({
      where: { id: productId },
      select: { name: true, category: true, image: true, price: true },
    });
    if (!product) throw new NotFoundException('商品不存在');
    const category = await this.resolveCategory(storeId, product.category);
    return this.prisma.scanOrderingMenuProduct.create({
      data: {
        storeId,
        productId,
        categoryId: category.id,
        name: product.name,
        imageUrl: product.image,
        basePrice: product.price,
        isActive: false,
      },
      select: { id: true },
    });
  }

  async resolveCategory(
    storeId: number,
    name: string,
  ): Promise<{ id: number }> {
    const normalized = name.trim();
    const existing = await this.prisma.scanOrderingMenuCategory.findFirst({
      where: { storeId, name: normalized, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;
    const last = await this.prisma.scanOrderingMenuCategory.findFirst({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
      select: { sortOrder: true },
    });
    return this.prisma.scanOrderingMenuCategory.create({
      data: {
        storeId,
        name: normalized || '默认分类',
        sortOrder: (last?.sortOrder ?? -1) + 1,
      },
      select: { id: true },
    });
  }

  /**
   * 失效扫码菜单缓存：商家端与顾客端两份都要清。
   *
   * - 商家端 `scanordering:menu:{storeId}`（固定 key，300s）
   * - 顾客端 `club:menu:store:{storeId}:v:{menuVersion}`（30s）——key 带内容哈希，
   *   写侧拿不到当前 hash，只能按 pattern 删，否则改价/改库存后 C 端菜单要等 TTL 才更新。
   * - 顾客端菜单版本缓存 `club:menu-version:store:{storeId}`（10s）——版本被缓存后，
   *   不主动删除会导致改价/改库存最长延后一个版本 TTL 才被 C 端发现。
   */
  async invalidateCache(storeId: number): Promise<void> {
    try {
      await this.redisService.del(`scanordering:menu:${storeId}`);
      await this.redisService.delByPattern(buildClubMenuPattern(storeId));
      await this.redisService.del(buildClubMenuVersionCacheKey(storeId));
    } catch {
      return;
    }
  }
}
