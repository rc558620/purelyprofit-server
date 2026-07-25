import { Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 扫码点餐定价版本计算服务。
 *
 * 职责：
 * - 为预览和创建订单提供稳定的 `pricingVersion`；
 * - 输入包含购物车行版本、商品版本/价格/状态、规格组版本、规格项版本/价格/状态、
 *   营销版本（空值）、优惠券状态（空值）、服务费/税费规则版本（空值）；
 * - 将规范化后的稳定 JSON 做 SHA-256；
 * - 预览与创建订单必须使用同一服务计算版本；
 * - 创建订单必须拒绝过期 `pricingVersion`。
 *
 * 设计约束：
 * - 不得使用"数量 + 单价"的简单数值相加作为购物车版本；
 * - 必须覆盖商品启用/停售、价格变更、版本变更、规格组/规格项变更等场景；
 * - 无任何变更时，同一购物车预览版本稳定一致。
 */
@Injectable()
export class ScanOrderingPricingVersionService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 为当前购物车会话计算稳定的定价版本哈希。
   *
   * 收集的维度：
   * 1. 会话 ID
   * 2. 购物车行：id / version / quantity
   * 3. 商品：id / version / basePrice / isActive
   * 4. 规格组：id / version / 选择规则
   * 5. 规格项：id / version / extraPrice / isActive / stockQuantity
   * 6. 营销版本：null（当前无营销能力）
   * 7. 优惠券状态：null（当前无优惠券）
   * 8. 服务费规则：null
   * 9. 税费规则：null
   */
  async computePricingVersion(sessionId: number): Promise<string> {
    const cartItems = await this.prisma.scanOrderingCartItem.findMany({
      where: { sessionId, status: 'active', deletedAt: null },
      select: {
        id: true,
        version: true,
        quantity: true,
        menuProductId: true,
        specs: { select: { specOptionId: true } },
      },
      orderBy: { id: 'asc' },
    });

    if (cartItems.length === 0) {
      return this.hashStableJson({
        sessionId,
        cartItems: [],
        products: [],
        specOptions: [],
      });
    }

    const productIds = [
      ...new Set(cartItems.map((item) => item.menuProductId)),
    ];
    const products = await this.prisma.scanOrderingMenuProduct.findMany({
      where: { id: { in: productIds }, deletedAt: null },
      select: {
        id: true,
        version: true,
        basePrice: true,
        isActive: true,
        stockMode: true,
        stockQuantity: true,
        specGroups: {
          where: { isActive: true },
          select: {
            id: true,
            version: true,
            selectionType: true,
            minSelections: true,
            maxSelections: true,
            isActive: true,
            options: {
              select: {
                id: true,
                version: true,
                extraPrice: true,
                isActive: true,
                stockQuantity: true,
              },
            },
          },
        },
      },
    });

    const specOptionIds = new Set<number>();
    for (const item of cartItems) {
      for (const spec of item.specs) {
        specOptionIds.add(spec.specOptionId);
      }
    }
    const specOptions =
      specOptionIds.size > 0
        ? await this.prisma.scanOrderingSpecOption.findMany({
            where: { id: { in: [...specOptionIds] } },
            select: {
              id: true,
              version: true,
              extraPrice: true,
              isActive: true,
              stockQuantity: true,
            },
          })
        : [];

    const stablePayload = {
      sessionId,
      cartItems: cartItems.map((item) => ({
        id: item.id,
        version: item.version,
        quantity: item.quantity,
        productId: item.menuProductId,
        specOptionIds: item.specs
          .map((s) => s.specOptionId)
          .sort((a, b) => a - b),
      })),
      products: products
        .map((p) => ({
          id: p.id,
          version: p.version,
          basePrice: p.basePrice,
          isActive: p.isActive,
          stockMode: p.stockMode,
          stockQuantity: p.stockQuantity,
          specGroups: p.specGroups
            .map((g) => ({
              id: g.id,
              version: g.version,
              selectionType: g.selectionType,
              minSelections: g.minSelections,
              maxSelections: g.maxSelections,
              isActive: g.isActive,
              options: g.options
                .map((o) => ({
                  id: o.id,
                  version: o.version,
                  extraPrice: o.extraPrice,
                  isActive: o.isActive,
                  stockQuantity: o.stockQuantity,
                }))
                .sort((a, b) => a.id - b.id),
            }))
            .sort((a, b) => a.id - b.id),
        }))
        .sort((a, b) => a.id - b.id),
      specOptions: specOptions
        .map((o) => ({
          id: o.id,
          version: o.version,
          extraPrice: o.extraPrice,
          isActive: o.isActive,
          stockQuantity: o.stockQuantity,
        }))
        .sort((a, b) => a.id - b.id),
      marketingVersion: null,
      couponVersion: null,
      serviceFeeVersion: null,
      taxVersion: null,
    };

    return this.hashStableJson(stablePayload);
  }

  /**
   * 将规范化后的稳定 JSON 做 SHA-256。
   */
  private hashStableJson(payload: unknown): string {
    const json = JSON.stringify(payload);
    return createHash('sha256').update(json).digest('hex');
  }
}
