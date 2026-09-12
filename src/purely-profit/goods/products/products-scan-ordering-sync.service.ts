import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RedisService } from '../../../redis/redis.service';
import { Money } from '../../../shared/money.utils';
import type { ProductSpecGroupDto } from './dto/product.dto';
import type { ProductRecord } from './products.types';

@Injectable()
export class ProductsScanOrderingSyncService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redisService: RedisService,
  ) {}

  validateSpecificationGroups(groups: ProductSpecGroupDto[]): void {
    const groupNames = new Set<string>();
    for (const group of groups) {
      const name = group.name.trim();
      if (!name) throw new BadRequestException('规格组名称不能为空');
      if (groupNames.has(name))
        throw new BadRequestException('规格组名称不能重复');
      groupNames.add(name);
      if (group.options.length === 0)
        throw new BadRequestException('每个规格组至少需要一个选项');
      if (group.selectMode === 'single' && group.maxSelect !== 1)
        throw new BadRequestException('单选规格组最多只能选择一项');
      // null 表示不限选；显式上限必须是 >=1 的合法数量。
      if (group.maxSelect !== null) {
        if (group.maxSelect < 1)
          throw new BadRequestException('最多选择数量不能小于 1');
        if (
          group.minSelect > group.maxSelect ||
          group.maxSelect > group.options.length
        )
          throw new BadRequestException('规格组选择数量不合法');
      }
      const optionNames = new Set<string>();
      const activeOptions = group.options.filter((option) => option.isActive);
      const defaults = activeOptions.filter((option) => option.isDefault);
      if (group.minSelect > activeOptions.length)
        throw new BadRequestException('启用规格选项不足以满足最少选择数量');
      if (group.selectMode === 'single' && defaults.length > 1)
        throw new BadRequestException('单选规格组最多只能设置一个默认项');
      for (const option of group.options) {
        const optionName = option.name.trim();
        if (!optionName) throw new BadRequestException('规格选项名称不能为空');
        if (optionNames.has(optionName))
          throw new BadRequestException('同一规格组的选项名称不能重复');
        optionNames.add(optionName);
      }
    }
  }

  async syncSpecifications(
    storeId: number,
    productId: number,
    groups: ProductSpecGroupDto[],
  ): Promise<void> {
    const existingMenuProduct = await this.findMenuProduct(storeId, productId);
    // 空规格短路：全业态放开规格配置后，未配置规格的商品（含每次编辑保存）不得
    // 凭空生成幽灵宿主，否则非餐饮门店每次编辑商品都会静默多出一条菜单商品记录。
    if (groups.length === 0 && !existingMenuProduct) return;
    const menuProduct =
      existingMenuProduct ??
      (await this.createGhostMenuProduct(storeId, productId));
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
      if (this.hasSameSpecifications(currentGroups, groups)) return;

      await tx.scanOrderingSpecOption.deleteMany({
        where: { group: { menuProductId: menuProduct.id } },
      });
      await tx.scanOrderingSpecGroup.deleteMany({
        where: { menuProductId: menuProduct.id },
      });
      if (groups.length === 0) return;
      await tx.scanOrderingSpecGroup.createMany({
        data: groups.map((group) => ({
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
        orderBy: { sortOrder: 'asc' },
        select: { id: true },
      });
      await tx.scanOrderingSpecOption.createMany({
        data: groups.flatMap((group, groupIndex) =>
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
  }

  /**
   * 已落库规格与待写入规格的内容是否完全一致（按排序后的位置逐项比较，不比较 ID）。
   *
   * 只比内容不比 ID，是因为新建选项的 ID 由前端生成占位值（`new-opt-x`），
   * 与库里的数字 ID 天然不同；真正需要防的是「内容没变却把 ID 重建一遍」。
   */
  private hasSameSpecifications(
    current: Array<{
      name: string;
      selectionType: string;
      minSelections: number;
      maxSelections: number | null;
      sortOrder: number;
      options: Array<{
        name: string;
        extraPrice: number;
        isDefault: boolean;
        isActive: boolean;
        sortOrder: number;
      }>;
    }>,
    next: ProductSpecGroupDto[],
  ): boolean {
    const sortedNext = [...next].sort((left, right) => left.sort - right.sort);
    if (current.length !== sortedNext.length) return false;

    return sortedNext.every((group, groupIndex) => {
      const currentGroup = current[groupIndex];
      if (
        currentGroup.name !== group.name.trim() ||
        currentGroup.selectionType !==
          (group.selectMode === 'multi' ? 'multiple' : 'single') ||
        currentGroup.minSelections !== group.minSelect ||
        currentGroup.maxSelections !== group.maxSelect ||
        currentGroup.sortOrder !== group.sort
      ) {
        return false;
      }

      if (currentGroup.options.length !== group.options.length) return false;
      return group.options.every((option, optionIndex) => {
        const currentOption = currentGroup.options[optionIndex];
        return (
          currentOption.name === option.name.trim() &&
          currentOption.extraPrice ===
            Money.fromInputYuan(option.priceDelta).toDbCents() &&
          currentOption.isDefault === option.isDefault &&
          currentOption.isActive === option.isActive &&
          currentOption.sortOrder === optionIndex
        );
      });
    });
  }

  async enable(product: ProductRecord, categoryId?: number): Promise<void> {
    const existing = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: {
        storeId: product.storeId,
        productId: product.id,
        deletedAt: null,
      },
    });
    const resolvedCategoryId =
      categoryId ??
      (await this.resolveCategory(product.storeId, product.category)).id;
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
    const category = await this.prisma.scanOrderingMenuCategory.findFirst({
      where: {
        id: resolvedCategoryId,
        storeId: product.storeId,
        deletedAt: null,
      },
    });
    if (!category) throw new BadRequestException('扫码菜单分类不存在');
    const conflict = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { storeId: product.storeId, name: product.name, deletedAt: null },
      select: { id: true, productId: true },
    });
    if (conflict && conflict.productId !== product.id)
      throw new ConflictException('同一门店的扫码菜单商品名称不能重复');
    if (conflict) {
      await this.prisma.scanOrderingMenuProduct.update({
        where: { id: conflict.id },
        data: {
          productId: product.id,
          categoryId: resolvedCategoryId,
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
        categoryId: resolvedCategoryId,
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

  async invalidateCache(storeId: number): Promise<void> {
    try {
      await this.redisService.del(`scanordering:menu:${storeId}`);
    } catch {
      return;
    }
  }
}
