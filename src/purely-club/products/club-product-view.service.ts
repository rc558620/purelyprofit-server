import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  ClubProductDto,
  ClubServiceProductTypeValue,
} from './dto/club-product.dto';
import type {
  ClubFirstOrderPromotion,
  ClubProductRecord,
} from './club-products.types';

@Injectable()
export class ClubProductViewService {
  toClubProduct(
    product: ClubProductRecord,
    hotProductIds: Set<number>,
    firstOrderPromotion: ClubFirstOrderPromotion | null,
  ): ClubProductDto {
    const isHot = hotProductIds.has(product.id);
    const categoryTag = this.getCategoryName(product);
    const stock = this.getProductStock(product);
    const validityDesc = this.buildValidityDesc(product);
    const memberPriceFen = firstOrderPromotion
      ? this.applyDiscountRate(product.price, firstOrderPromotion.discountRate)
      : product.price;
    const tags = Array.from(
      new Set([
        ...(isHot ? ['热销'] : []),
        ...(categoryTag ? [categoryTag] : []),
        ...(product.personCount && product.personCount > 1 ? ['多人适用'] : []),
      ]),
    );

    return {
      id: String(product.id),
      name: product.name,
      description: product.description?.trim() || '暂无服务说明',
      coverImage: product.image?.trim() || '',
      originalPrice: this.convertFenToYuan(
        product.originalPrice ?? product.price,
      ),
      memberPrice: this.convertFenToYuan(memberPriceFen),
      ...(firstOrderPromotion
        ? {
            promotionId: String(firstOrderPromotion.id),
            promotionType: 'first_order_discount',
            discountRate: firstOrderPromotion.discountRate,
            promotionTag: firstOrderPromotion.tag,
          }
        : {}),
      type: this.resolveProductType(product),
      tags,
      isHot,
      ...(stock >= 0 ? { stock } : {}),
      ...(validityDesc ? { validityDesc } : {}),
      details: this.buildDetails(product, stock),
    };
  }

  private resolveProductType(
    product: ClubProductRecord,
  ): ClubServiceProductTypeValue {
    if (product.personCount && product.personCount > 1) {
      return 'package';
    }

    if (product.durationMinutes && product.durationMinutes >= 90) {
      return 'experience';
    }

    return 'product';
  }

  private buildValidityDesc(product: ClubProductRecord): string | undefined {
    const parts: string[] = [];
    if (product.durationMinutes) {
      parts.push(`单次服务约 ${product.durationMinutes} 分钟`);
    }
    if (product.personCount) {
      parts.push(`适用 ${product.personCount} 人`);
    }
    return parts.length > 0 ? parts.join(' · ') : undefined;
  }

  private buildDetails(product: ClubProductRecord, stock: number): string[] {
    const categoryName = this.getCategoryName(product);
    const details = [
      product.description?.trim() || '',
      categoryName ? `服务分类：${categoryName}` : '',
      product.durationMinutes
        ? `参考时长：${product.durationMinutes} 分钟`
        : '',
      product.personCount ? `适用人数：${product.personCount} 人` : '',
      stock >= 0 ? `当前库存：${stock} 份` : '',
    ].filter((item) => item.length > 0);

    return details.length > 0 ? details : ['暂无服务详情'];
  }

  private getCategoryName(product: ClubProductRecord): string {
    return product.category?.name?.trim() ?? '';
  }

  private getProductStock(product: ClubProductRecord): number {
    return typeof product.stock === 'number' ? product.stock : -1;
  }

  private applyDiscountRate(amountFen: number, discountRate: number): number {
    return new Decimal(amountFen)
      .mul(discountRate)
      .div(100)
      .toDecimalPlaces(0, Decimal.ROUND_HALF_UP)
      .toNumber();
  }

  private convertFenToYuan(amountFen: number): number {
    return new Decimal(amountFen).div(100).toDecimalPlaces(2).toNumber();
  }
}
