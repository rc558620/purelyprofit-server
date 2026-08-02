import { Injectable } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import type { ClubOrderBreakdownItemDto } from './dto/club-order.dto';

@Injectable()
export class ClubOrderPreviewBreakdownService {
  build(params: {
    memberBaselineFen: number;
    originalPriceFen: number;
    discountAmountFen: number;
    promotionDiscountAmountFen: number;
    promotionType: string | null;
    promotionTag: string | null;
    discountRate: number | null;
    totalReduceFen: number;
    finalPriceFen: number;
    memberDiscountRate: number | null;
  }): ClubOrderBreakdownItemDto[] {
    const items: ClubOrderBreakdownItemDto[] = [
      {
        id: 'member-price',
        label: '会员售价',
        value: `¥${this.formatFenToYuanText(params.memberBaselineFen)}`,
        isDeduction: false,
        isStrikethrough: false,
      },
    ];
    const memberRate = params.memberDiscountRate;
    const hasMemberRate = memberRate != null && memberRate < 1;
    const levelDiscountFen = hasMemberRate
      ? Math.round(params.memberBaselineFen * (1 - memberRate))
      : 0;
    const hasActivity = params.promotionType !== null;
    if (levelDiscountFen > 0 && hasMemberRate) {
      items.push({
        id: 'level-discount',
        label: `会员等级折扣 ${this.formatDiscountRateLabel(memberRate)}`,
        value: `-¥${this.formatFenToYuanText(levelDiscountFen)}`,
        isDeduction: !hasActivity,
        isStrikethrough: hasActivity,
      });
    }
    if (
      params.promotionType !== null &&
      params.promotionDiscountAmountFen > 0
    ) {
      items.push({
        id: `promotion-${params.promotionType}`,
        label:
          params.discountRate != null
            ? `活动折扣 ${this.formatDiscountRateLabel(params.discountRate / 100)}`
            : (params.promotionTag ?? '活动折扣'),
        value: `-¥${this.formatFenToYuanText(params.promotionDiscountAmountFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }
    if (params.totalReduceFen > 0) {
      items.push({
        id: 'reduce',
        label: '满减优惠',
        value: `-¥${this.formatFenToYuanText(params.totalReduceFen)}`,
        isDeduction: true,
        isStrikethrough: false,
      });
    }
    items.push({
      id: 'price-before-points',
      label: '优惠后小计',
      value: `¥${this.formatFenToYuanText(params.finalPriceFen)}`,
      isDeduction: false,
      isStrikethrough: false,
    });
    return items;
  }

  private formatFenToYuanText(cents: number): string {
    return Money.fromDbCents(cents)
      .toFixedOutputYuan()
      .replace(/\.00$/, '')
      .replace(/(\.\d)0$/, '$1');
  }

  private formatDiscountRateLabel(rate: number): string {
    const zhe = +(rate * 10).toFixed(1);
    return `${zhe}折`;
  }
}
