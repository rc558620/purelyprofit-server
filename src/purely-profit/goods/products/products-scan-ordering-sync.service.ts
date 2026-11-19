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
import type { Prisma } from '@prisma/client';
import type { ProductSpecGroupDto } from './dto/product.dto';
import type { ProductScalarRecord } from './products.types';
import {
  hasSameProductSpecifications,
  validateProductSpecificationGroups,
} from './products-scan-ordering-spec.shared';

/** 规格增量同步事务上限：一次编辑最多 5 组 × 20 选项，逐条写需要留足余量 */
const SPEC_SYNC_TRANSACTION_TIMEOUT_MS = 15_000;

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
    tx?: Prisma.TransactionClient,
  ): Promise<boolean> {
    // 调用方已开事务（商品编辑要求「商品 + 规格 + 菜单」原子提交）时，
    // 缓存失效必须由调用方在提交后执行：事务内清缓存会在回滚后留下脏读窗口。
    if (tx) {
      return this.syncSpecificationsWithClient(tx, storeId, productId, groups);
    }
    // 空规格快速路径：没有宿主的商品（含非餐饮门店的常规编辑）不写库、不开事务，
    // 避免「每次编辑不配规格的商品都白开一个事务」。
    const prefetchedMenuProduct =
      groups.length === 0
        ? await this.findMenuProduct(storeId, productId)
        : undefined;
    if (groups.length === 0 && !prefetchedMenuProduct) return false;
    const changed = await this.prisma.$transaction(
      (client) =>
        this.syncSpecificationsWithClient(
          client,
          storeId,
          productId,
          groups,
          prefetchedMenuProduct,
        ),
      { timeout: SPEC_SYNC_TRANSACTION_TIMEOUT_MS },
    );
    if (changed) await this.invalidateCache(storeId);
    return changed;
  }

  /**
   * 规格增量同步：按稳定 ID 更新，不再「全删全建」。
   *
   * 选项 ID 会被历史订单的 `scan_order_item_specs.spec_option_id` 引用（该表无外键），
   * 物理重建后 ID 漂移，退款/释放预留按旧 ID 恢复库存时会静默丢量。因此：
   * - 入参带 id 且属于当前菜单商品 → 原地更新，ID、库存、预留量保持不变；
   * - 入参未带 id → 新建选项（旧前端 / 新增选项）；
   * - 现有选项不在入参中 → 无历史引用时删除，有引用时停用并取消默认；
   * - 现有规格组未被入参命中 → 组内仍有保留选项时停用，否则删除。
   */
  private async syncSpecificationsWithClient(
    client: Prisma.TransactionClient,
    storeId: number,
    productId: number,
    groups: ProductSpecGroupDto[],
    prefetchedMenuProduct?: { id: number } | null,
  ): Promise<boolean> {
    const existingMenuProduct =
      prefetchedMenuProduct !== undefined
        ? prefetchedMenuProduct
        : await this.findMenuProduct(storeId, productId, client);
    // 空规格短路：全业态放开规格配置后，未配置规格的商品（含每次编辑保存）不得
    // 凭空生成幽灵宿主，否则非餐饮门店每次编辑商品都会静默多出一条菜单商品记录。
    if (groups.length === 0 && !existingMenuProduct) return false;
    const menuProduct =
      existingMenuProduct ??
      (await this.createGhostMenuProduct(storeId, productId, client));
    // 无变更则不写库：内容完全一致时直接跳过，避免无谓的 updatedAt/version 抖动。
    const currentGroups = await client.scanOrderingSpecGroup.findMany({
      where: { menuProductId: menuProduct.id },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      select: {
        id: true,
        name: true,
        selectionType: true,
        minSelections: true,
        maxSelections: true,
        sortOrder: true,
        options: {
          orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
          select: {
            id: true,
            name: true,
            extraPrice: true,
            isDefault: true,
            isActive: true,
            sortOrder: true,
          },
        },
      },
    });
    if (hasSameProductSpecifications(currentGroups, groups)) return false;

    await this.applySpecifications(
      client,
      menuProduct.id,
      currentGroups,
      groups,
    );
    return true;
  }

  private async applySpecifications(
    client: Prisma.TransactionClient,
    menuProductId: number,
    currentGroups: Array<{
      id: number;
      options: Array<{
        id: number;
        name: string;
        extraPrice: number;
        isDefault: boolean;
        isActive: boolean;
        sortOrder: number;
      }>;
    }>,
    groups: ProductSpecGroupDto[],
  ): Promise<void> {
    const sortedGroups = [...groups].sort(
      (left, right) => left.sort - right.sort,
    );
    const matchedGroupIds = new Set<number>();
    const matchedOptionIds = new Set<number>();

    for (const group of sortedGroups) {
      // 显式 id 只认 id：旧前端不传 id 时才按位置兜底，
      // 避免「id 已失效」时把内容写到不相关的规格组上。
      const matchedGroup = group.id
        ? currentGroups.find(
            (item) =>
              String(item.id) === group.id && !matchedGroupIds.has(item.id),
          )
        : currentGroups.find((item) => !matchedGroupIds.has(item.id));

      const groupData = {
        name: group.name.trim(),
        selectionType:
          group.selectMode === 'multi'
            ? ('multiple' as const)
            : ('single' as const),
        minSelections: group.minSelect,
        // null 表示不限选，直接保留；不要回退为选项数量，否则“多选不限”会被误限。
        maxSelections: group.maxSelect,
        sortOrder: group.sort,
      };

      let groupId: number;
      if (matchedGroup) {
        matchedGroupIds.add(matchedGroup.id);
        groupId = matchedGroup.id;
        await client.scanOrderingSpecGroup.update({
          where: { id: groupId },
          // 曾因在途引用被停用的组，重新提交后恢复启用
          data: { ...groupData, isActive: true },
        });
      } else {
        const created = await client.scanOrderingSpecGroup.create({
          data: { menuProductId, ...groupData, isActive: true },
          select: { id: true },
        });
        groupId = created.id;
      }

      for (const [optionIndex, option] of group.options.entries()) {
        const optionData = {
          name: option.name.trim(),
          extraPrice: Money.fromInputYuan(option.priceDelta).toDbCents(),
          sortOrder: optionIndex,
          isDefault: option.isDefault,
          isActive: option.isActive,
        };
        const matchedOption =
          matchedGroup && option.id
            ? matchedGroup.options.find(
                (item) =>
                  String(item.id) === option.id &&
                  !matchedOptionIds.has(item.id),
              )
            : undefined;
        if (matchedOption) {
          matchedOptionIds.add(matchedOption.id);
          await client.scanOrderingSpecOption.update({
            where: { id: matchedOption.id },
            // 只更新展示与价格字段：stockQuantity / reservedQuantity 原样保留
            data: { ...optionData, groupId },
          });
        } else {
          const created = await client.scanOrderingSpecOption.create({
            data: { groupId, ...optionData },
            select: { id: true },
          });
          matchedOptionIds.add(created.id);
        }
      }
    }

    const orphanOptions = currentGroups
      .flatMap((group) => group.options)
      .filter((option) => !matchedOptionIds.has(option.id));
    const referencedOptionIds = await this.findReferencedOptionIds(
      client,
      orphanOptions.map((option) => option.id),
    );
    const keptOptionIds = new Set<number>();
    for (const option of orphanOptions) {
      if (referencedOptionIds.has(option.id)) {
        keptOptionIds.add(option.id);
        await client.scanOrderingSpecOption.update({
          where: { id: option.id },
          // 历史订单仍引用：停用而不是物理删除，保留 ID 供退款/释放预留回溯
          data: { isActive: false, isDefault: false },
        });
        continue;
      }
      await client.scanOrderingSpecOption.delete({ where: { id: option.id } });
    }

    for (const group of currentGroups) {
      if (matchedGroupIds.has(group.id)) continue;
      const hasKeptOption = group.options.some((option) =>
        keptOptionIds.has(option.id),
      );
      if (hasKeptOption) {
        await client.scanOrderingSpecGroup.update({
          where: { id: group.id },
          data: { isActive: false },
        });
        continue;
      }
      await client.scanOrderingSpecGroup.delete({ where: { id: group.id } });
    }
  }

  private async findReferencedOptionIds(
    client: Prisma.TransactionClient,
    optionIds: number[],
  ): Promise<Set<number>> {
    if (optionIds.length === 0) return new Set<number>();
    const rows = await client.scanOrderItemSpec.findMany({
      where: { specOptionId: { in: optionIds } },
      select: { specOptionId: true },
      distinct: ['specOptionId'],
    });
    return new Set(rows.map((row) => row.specOptionId));
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
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    if (Object.keys(updates).length === 0) return;
    // 事务内同步：写失败必须冒泡让整个事务回滚，不能像独立调用那样吞掉，
    // 否则「商品已改、菜单仍旧」的半成功会以成功响应返回给商家。
    if (tx) {
      await tx.scanOrderingMenuProduct.updateMany({
        where: { storeId, productId, deletedAt: null },
        data: updates,
      });
      return;
    }
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
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: number } | null> {
    return client.scanOrderingMenuProduct.findFirst({
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
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: number }> {
    const product = await client.product.findUnique({
      where: { id: productId },
      select: { name: true, category: true, image: true, price: true },
    });
    if (!product) throw new NotFoundException('商品不存在');
    const category = await this.resolveCategory(
      storeId,
      product.category,
      client,
    );
    return client.scanOrderingMenuProduct.create({
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
    client: PrismaService | Prisma.TransactionClient = this.prisma,
  ): Promise<{ id: number }> {
    const normalized = name.trim();
    const existing = await client.scanOrderingMenuCategory.findFirst({
      where: { storeId, name: normalized, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;
    const last = await client.scanOrderingMenuCategory.findFirst({
      where: { storeId, deletedAt: null },
      orderBy: [{ sortOrder: 'desc' }, { id: 'desc' }],
      select: { sortOrder: true },
    });
    return client.scanOrderingMenuCategory.create({
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
