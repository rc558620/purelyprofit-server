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

  async ensureCateringStore(storeId: number): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { businessMode: true },
    });
    if (!store || store.businessMode !== 'catering')
      throw new BadRequestException('仅餐饮门店允许配置商品规格');
  }

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
    const menuProduct = await this.resolveMenuProduct(storeId, productId);
    await this.prisma.$transaction(async (tx) => {
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

  private async resolveMenuProduct(
    storeId: number,
    productId: number,
  ): Promise<{ id: number }> {
    const existing = await this.prisma.scanOrderingMenuProduct.findFirst({
      where: { storeId, productId, deletedAt: null },
      select: { id: true },
    });
    if (existing) return existing;
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
