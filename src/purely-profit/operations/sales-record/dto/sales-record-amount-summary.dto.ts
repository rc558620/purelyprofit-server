import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsNumber, IsString } from 'class-validator';

export class ScanOrderingDiscountItemDto {
  @IsString()
  @ApiProperty({
    example: '会员等级折扣 8折',
    description: '优惠项展示标签（如“会员等级折扣 8折”“满50减8”）',
  })
  label: string;

  @IsNumber()
  @ApiProperty({
    example: -20.5,
    description: '优惠金额（元）；负数表示减免',
  })
  amount: number;

  @IsBoolean()
  @ApiProperty({
    example: false,
    description: '被覆盖/失效优惠：true 时前端划线展示',
  })
  isStrikethrough: boolean;
}

/** 扫码点餐订单金额汇总（元，全部由后端计算，前端只读展示）。 */
export class ScanOrderingAmountSummaryDto {
  @IsNumber()
  @ApiProperty({ example: 508, description: '商品基础价合计（元）' })
  itemOriginalAmount: number;

  @IsNumber()
  @ApiProperty({ example: 16, description: '规格加价合计（元）' })
  specificationExtraAmount: number;

  @IsNumber()
  @ApiProperty({
    example: 524,
    description: '优惠前总价（元，= 商品基础价 + 规格加价，未扣任何优惠）',
  })
  totalBeforeDiscount: number;

  @IsNumber()
  @ApiProperty({
    example: 404.8,
    description: '应付金额（元，含所有优惠与积分抵扣）',
  })
  payableAmount: number;

  @IsNumber()
  @ApiProperty({
    example: 119.2,
    description: '总优惠金额（元，= 商品原价 + 规格加价 − 应付，由后端计算）',
  })
  discountAmount: number;

  @IsNumber()
  @ApiProperty({ example: 0, description: '积分抵扣金额（元）' })
  pointsDeductAmount: number;

  @IsArray()
  @ApiProperty({
    type: [ScanOrderingDiscountItemDto],
    description: '优惠清单明细（仅减免项，amount 为负）',
  })
  discountItems: ScanOrderingDiscountItemDto[];
}
