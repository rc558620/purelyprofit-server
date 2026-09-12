import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';

/** 定价入参：非餐饮两条链路（追加点单 / 自助下单）共用 */
export interface PriceProductSpecsInput {
  storeId: number;
  /** Product.id（不是菜单商品 ID） */
  productId: number;
  /** 已选规格选项 ID；不传或空数组表示无规格 */
  specOptionIds?: number[] | null;
}

/** 服务端权威定价结果（金额单位一律为「分」） */
export interface PricedProductSpecs {
  /** 规格宿主（ScanOrderingMenuProduct）ID；无规格时为 null */
  menuProductId: number | null;
  /** 权威单价 = Product.price + Σ 选项加价 */
  unitPriceCents: number;
  /** 成本单价；商品未设置成本价时为 0 */
  costPriceCents: number;
  /** 单件利润 = 单价 − 成本（规格加价等额计入利润，纯毛利） */
  profitCents: number;
  /** 归一后的已选选项 ID（升序去重） */
  specOptionIds: number[];
  /** 商品分类名快照 */
  categoryName: string | null;
  /** 规格名（按组/选项排序，如 ['大杯', '热']） */
  specNames: string[];
  /** 已选选项快照（供订单行规格明细表落库；extraPrice 单位为分） */
  specOptions: Array<{ id: number; name: string; extraPrice: number }>;
  /** 规格签名：选项 ID 升序的 sha256；无规格时为 null（用于订单行合并键） */
  specSignature: string | null;
  /** 展示名（如「拿铁（大杯/热）」）；无规格时为商品名 */
  displayName: string;
}

/**
 * 非餐饮商品规格的「校验 + 权威定价」共享服务。
 *
 * 与餐饮扫码点餐的关键差异：**加价基准是 `Product.price`**，不是 `MenuProduct.basePrice`。
 * 两条链路（追加点单、自助下单）都必须走这里，避免各自实现导致价格口径分裂。
 *
 * 调用方职责：前端传来的 salePrice 仅作兜底展示，**落库必须以本服务的 unitPriceCents 为准**。
 */
@Injectable()
export class ProductSpecPricingService {
  constructor(private readonly prisma: PrismaService) {}

  async price(input: PriceProductSpecsInput): Promise<PricedProductSpecs> {
    const product = await this.findProduct(input.storeId, input.productId);

    const basePriceMoney = Money.fromDbCents(product.price);
    const costPriceCents = product.costPrice ?? 0;
    const selectedIds = normalizeOptionIds(input.specOptionIds);

    if (selectedIds.length === 0) {
      return this.buildResult({
        productName: product.name,
        categoryName: product.category ?? null,
        menuProductId: null,
        basePriceMoney,
        costPriceCents,
        selectedOptions: [],
      });
    }

    const menuProduct = product.scanOrderingMenuProducts[0] ?? null;
    if (!menuProduct || menuProduct.specGroups.length === 0) {
      throw new BadRequestException('商品规格已更新，请重新选择');
    }

    const selectedOptions = this.resolveSelectedOptions(
      menuProduct.specGroups,
      selectedIds,
    );
    this.ensureSelectionsWithinRange(menuProduct.specGroups, selectedOptions);

    return this.buildResult({
      productName: product.name,
      categoryName: product.category ?? null,
      menuProductId: menuProduct.id,
      basePriceMoney,
      costPriceCents,
      selectedOptions,
    });
  }

  private async findProduct(storeId: number, productId: number) {
    const product = await this.prisma.product.findFirst({
      where: {
        id: productId,
        storeId,
        isActive: true,
        deletedAt: null,
      },
      select: {
        id: true,
        name: true,
        category: true,
        price: true,
        costPrice: true,
        scanOrderingMenuProducts: {
          where: { deletedAt: null },
          orderBy: { id: 'asc' },
          take: 1,
          select: {
            id: true,
            specGroups: {
              orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
              select: {
                id: true,
                name: true,
                minSelections: true,
                maxSelections: true,
                options: {
                  orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
                  select: {
                    id: true,
                    name: true,
                    extraPrice: true,
                    isActive: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!product) throw new NotFoundException('商品不存在或已下架');
    return product;
  }

  /** 匹配已选选项；存在不属于该商品、或已停用的选项时直接拒绝 */
  private resolveSelectedOptions(
    groups: Array<{
      id: number;
      options: Array<{
        id: number;
        name: string;
        extraPrice: number;
        isActive: boolean;
      }>;
    }>,
    selectedIds: number[],
  ): Array<{ groupId: number; id: number; name: string; extraPrice: number }> {
    const selected = new Set(selectedIds);
    const matched = groups.flatMap((group) =>
      group.options
        .filter((option) => selected.has(option.id) && option.isActive)
        .map((option) => ({
          groupId: group.id,
          id: option.id,
          name: option.name,
          extraPrice: option.extraPrice,
        })),
    );

    if (matched.length !== selected.size) {
      throw new BadRequestException('商品规格已更新，请重新选择');
    }
    return matched;
  }

  /** 每组已选数量必须落在 [minSelections, maxSelections] 内；maxSelections 为 null 表示不限 */
  private ensureSelectionsWithinRange(
    groups: Array<{
      id: number;
      name: string;
      minSelections: number;
      maxSelections: number | null;
    }>,
    selectedOptions: Array<{ groupId: number }>,
  ): void {
    for (const group of groups) {
      const count = selectedOptions.filter(
        (option) => option.groupId === group.id,
      ).length;

      if (count < group.minSelections) {
        throw new BadRequestException(
          `规格【${group.name}】至少选择 ${group.minSelections} 项`,
        );
      }
      if (group.maxSelections !== null && count > group.maxSelections) {
        throw new BadRequestException(
          `规格【${group.name}】最多选择 ${group.maxSelections} 项`,
        );
      }
    }
  }

  private buildResult(params: {
    productName: string;
    categoryName: string | null;
    menuProductId: number | null;
    basePriceMoney: Money;
    costPriceCents: number;
    selectedOptions: Array<{
      groupId: number;
      id: number;
      name: string;
      extraPrice: number;
    }>;
  }): PricedProductSpecs {
    const {
      productName,
      categoryName,
      menuProductId,
      basePriceMoney,
      costPriceCents,
    } = params;
    const optionIds = params.selectedOptions.map((option) => option.id);
    const specNames = params.selectedOptions.map((option) => option.name);

    const unitPriceMoney = params.selectedOptions.reduce<Money>(
      (sum, option) => sum.add(Money.fromDbCents(option.extraPrice)),
      basePriceMoney,
    );
    const unitPriceCents = unitPriceMoney.toDbCents();

    return {
      menuProductId,
      unitPriceCents,
      costPriceCents,
      profitCents: unitPriceCents - costPriceCents,
      categoryName,
      specOptionIds: optionIds,
      specNames,
      specOptions: params.selectedOptions.map((option) => ({
        id: option.id,
        name: option.name,
        extraPrice: option.extraPrice,
      })),
      specSignature:
        optionIds.length === 0 ? null : hashSpecSignature(optionIds),
      displayName:
        specNames.length > 0
          ? `${productName}（${specNames.join('/')}）`
          : productName,
    };
  }
}

/** 选项 ID 去重升序；非整数直接丢弃 */
export function normalizeOptionIds(raw: number[] | null | undefined): number[] {
  return [
    ...new Set((raw ?? []).filter((id) => Number.isInteger(id) && id > 0)),
  ].sort((left, right) => left - right);
}

/** 规格签名：与扫码点餐购物车同口径（选项 ID 升序逗号拼接后 sha256） */
export function hashSpecSignature(sortedOptionIds: number[]): string {
  return createHash('sha256').update(sortedOptionIds.join(',')).digest('hex');
}
