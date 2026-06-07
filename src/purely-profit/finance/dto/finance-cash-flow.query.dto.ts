import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../stores/dto/store-response.dto';
import {
  FINANCE_CASH_FLOW_CATEGORY_VALUES,
  FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES,
  FINANCE_CASH_FLOW_DIRECTION_VALUES,
  FINANCE_CASH_FLOW_PAYMENT_VALUES,
  type FinanceCashFlowCategoryValue,
  type FinanceCashFlowDirectionValue,
  type FinanceCashFlowPaymentValue,
} from '../finance.types';

export class ListFinanceCashFlowRecordsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: [
      'today',
      'week',
      'month',
      'quarter',
      'year',
      'custom_day',
      'custom_range',
    ],
    description: '现金流水时间周期',
  })
  @IsOptional()
  @IsIn(
    ['today', 'week', 'month', 'quarter', 'year', 'custom_day', 'custom_range'],
    {
      message: '现金流水时间周期不合法',
    },
  )
  period?:
    | 'today'
    | 'week'
    | 'month'
    | 'quarter'
    | 'year'
    | 'custom_day'
    | 'custom_range';

  @ApiPropertyOptional({
    enum: FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES,
    description: '现金流水方向筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_CASH_FLOW_DIRECTION_FILTER_VALUES, {
    message: '现金流水方向筛选不合法',
  })
  directionFilter?: 'all' | FinanceCashFlowDirectionValue;

  @ApiPropertyOptional({ example: 2026, description: '自定义单日-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单日年份必须是整数' })
  customDayYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义单日-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单日月份必须是整数' })
  customDayMonth?: number;

  @ApiPropertyOptional({ example: 14, description: '自定义单日-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单日日份必须是整数' })
  customDayDay?: number;

  @ApiPropertyOptional({ example: 2026, description: '自定义区间开始-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间开始年份必须是整数' })
  customRangeStartYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义区间开始-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间开始月份必须是整数' })
  customRangeStartMonth?: number;

  @ApiPropertyOptional({ example: 1, description: '自定义区间开始-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间开始日必须是整数' })
  customRangeStartDay?: number;

  @ApiPropertyOptional({ example: 2026, description: '自定义区间结束-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间结束年份必须是整数' })
  customRangeEndYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义区间结束-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间结束月份必须是整数' })
  customRangeEndMonth?: number;

  @ApiPropertyOptional({ example: 14, description: '自定义区间结束-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义区间结束日必须是整数' })
  customRangeEndDay?: number;
}

export class CreateFinanceCashFlowRecordDto {
  @ApiProperty({
    enum: FINANCE_CASH_FLOW_DIRECTION_VALUES,
    description: '流水方向',
  })
  @IsIn(FINANCE_CASH_FLOW_DIRECTION_VALUES, { message: '流水方向不合法' })
  direction: FinanceCashFlowDirectionValue;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_CATEGORY_VALUES,
    description:
      '流水分类：sales 仅允许销售记录自动生成；refund/transfer_in/other_income 归入附加收入；purchase 单列进货支出；rent 店面租金；utilities 水电煤气；salary/marketing/tax/transfer_out/other_expense 归入成本支出',
  })
  @IsIn(FINANCE_CASH_FLOW_CATEGORY_VALUES, { message: '流水分类不合法' })
  category: FinanceCashFlowCategoryValue;

  @ApiProperty({ example: '午市营业额', description: '标题/摘要' })
  @IsString({ message: '流水标题必须是字符串' })
  @MaxLength(40, { message: '流水标题最多 40 个字符' })
  title: string;

  @ApiProperty({ example: 128.5, description: '金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '流水金额必须是数字' })
  @Min(0.01, { message: '流水金额必须大于 0' })
  amount: number;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_PAYMENT_VALUES,
    description: '支付方式',
  })
  @IsIn(FINANCE_CASH_FLOW_PAYMENT_VALUES, { message: '支付方式不合法' })
  payment: FinanceCashFlowPaymentValue;

  @ApiPropertyOptional({ example: '周末活动收入', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '发生时间必须是整数时间戳' })
  date: number;
}
