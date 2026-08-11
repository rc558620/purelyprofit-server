import { Injectable } from '@nestjs/common';
import { Money } from '../../shared/money.utils';
import { buildReduceTag } from './club-order-promotions.utils';
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
    /** 会员等级折扣是否在竞争中胜出（活动被覆盖）；true 时活动行划线展示 */
    memberWins?: boolean;
    /** 生效满减规则（门槛分/减免分），用于生成“满xxx减xxx”标签；缺省回退“满减优惠” */
    reduceRules?: Array<{ thresholdFen: number; reduceAmountFen: number }>;
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
    // 会员等级折扣胜出（活动被覆盖）时，会员行正常展示、活动行划线；
    // 活动胜出时维持原语义：会员行划线、活动行正常。
    const memberWins = params.memberWins === true;
    if (levelDiscountFen > 0 && hasMemberRate) {
      items.push({
        id: 'level-discount',
        label: `会员等级折扣 ${this.formatDiscountRateLabel(memberRate)}`,
        value: `-¥${this.formatFenToYuanText(levelDiscountFen)}`,
        isDeduction: !hasActivity || memberWins,
        isStrikethrough: hasActivity && !memberWins,
      });
    }
    if (
      params.promotionType !== null &&
      params.promotionDiscountAmountFen > 0
    ) {
      items.push({
        id: `promotion-${params.promotionType}`,
        // 首单优惠单独成标签（“首单 X折”），其余活动统一“活动折扣 X折”
        label:
          params.promotionType === 'first_order_discount'
            ? params.discountRate != null
              ? `首单 ${this.formatDiscountRateLabel(params.discountRate / 100)}`
              : (params.promotionTag ?? '首单优惠')
            : params.discountRate != null
              ? `活动折扣 ${this.formatDiscountRateLabel(params.discountRate / 100)}`
              : (params.promotionTag ?? '活动折扣'),
        value: `-¥${this.formatFenToYuanText(params.promotionDiscountAmountFen)}`,
        isDeduction: true,
        isStrikethrough: memberWins,
      });
    }
    if (params.totalReduceFen > 0) {
      items.push({
        id: 'reduce',
        label: this.buildReduceLabel(params.reduceRules),
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

  /** 满减标签：多个生效规则用顿号连接；无规则时回退“满减优惠” */
  private buildReduceLabel(
    reduceRules:
      | Array<{
          thresholdFen: number;
          reduceAmountFen: number;
        }>
      | undefined,
  ): string {
    if (!reduceRules || reduceRules.length === 0) {
      return '满减优惠';
    }
    return reduceRules
      .map((rule) =>
        buildReduceTag(rule.thresholdFen, rule.reduceAmountFen, ''),
      )
      .join('、');
  }
}
