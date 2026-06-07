import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { PaginationMetaDto } from '../../stores/dto/store-response.dto';
import {
  FINANCE_CASH_FLOW_CATEGORY_VALUES,
  FINANCE_CASH_FLOW_DIRECTION_VALUES,
  FINANCE_CASH_FLOW_PAYMENT_VALUES,
  type FinanceCashFlowCategoryValue,
  type FinanceCashFlowDirectionValue,
  type FinanceCashFlowPaymentValue,
} from '../finance.types';

export class FinanceCashFlowRecordResponseDto {
  @ApiProperty({ example: '1', description: '流水 ID' })
  @IsString({ message: '流水 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_DIRECTION_VALUES,
    description: '流水方向',
  })
  @IsIn(FINANCE_CASH_FLOW_DIRECTION_VALUES, { message: '流水方向不合法' })
  direction: FinanceCashFlowDirectionValue;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_CATEGORY_VALUES,
    description:
      '流水分类：sales 为销售自动流水；refund/transfer_in/other_income 参与附加收入口径；purchase 参与进货支出口径；rent 店面租金；utilities 水电煤气；salary/marketing/tax/transfer_out/other_expense 参与成本支出口径',
  })
  @IsIn(FINANCE_CASH_FLOW_CATEGORY_VALUES, { message: '流水分类不合法' })
  category: FinanceCashFlowCategoryValue;

  @ApiProperty({ example: '午市营业额', description: '标题' })
  @IsString({ message: '流水标题必须是字符串' })
  title: string;

  @ApiProperty({ example: 128.5, description: '金额，单位元' })
  @IsNumber({}, { message: '流水金额必须是数字' })
  amount: number;

  @ApiProperty({
    enum: FINANCE_CASH_FLOW_PAYMENT_VALUES,
    description: '支付方式',
  })
  @IsIn(FINANCE_CASH_FLOW_PAYMENT_VALUES, { message: '支付方式不合法' })
  payment: FinanceCashFlowPaymentValue;

  @ApiPropertyOptional({ example: '节假日活动', description: '备注' })
  @IsOptional()
  @IsString({ message: '流水备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @IsInt({ message: '发生时间必须是整数' })
  date: number;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;
}

export class FinanceCashFlowStatsDto {
  @ApiProperty({ example: 12880, description: '总收入' })
  @IsNumber({}, { message: '总收入必须是数字' })
  totalIncome: number;

  @ApiProperty({ example: 9320, description: '总支出' })
  @IsNumber({}, { message: '总支出必须是数字' })
  totalExpense: number;

  @ApiProperty({ example: 3560, description: '净现金流' })
  @IsNumber({}, { message: '净现金流必须是数字' })
  netFlow: number;

  @ApiProperty({ example: 18, description: '流水笔数' })
  @IsInt({ message: '流水笔数必须是整数' })
  recordCount: number;

  @ApiPropertyOptional({ example: 25.6, description: '较上期变化 %' })
  @IsOptional()
  @IsNumber({}, { message: '较上期变化必须是数字' })
  compareLastPeriod: number | null;
}

export class PaginatedFinanceCashFlowRecordsResponseDto {
  @ApiProperty({
    type: [FinanceCashFlowRecordResponseDto],
    description: '当前页现金流水列表',
  })
  @IsArray({ message: '现金流水列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceCashFlowRecordResponseDto)
  items: FinanceCashFlowRecordResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}
