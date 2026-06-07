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
  FINANCE_PAYMENT_CHANNEL_VALUES,
  FINANCE_RECONCILIATION_STATUS_VALUES,
  FINANCE_RECONCILIATION_TYPE_VALUES,
  type FinancePaymentChannelValue,
  type FinanceReconciliationStatusValue,
  type FinanceReconciliationTypeValue,
} from '../finance.types';

export class FinanceReconciliationItemResponseDto {
  @ApiProperty({ example: '1', description: '差异项 ID' })
  @IsString({ message: '差异项 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '微信手续费差异', description: '差异描述' })
  @IsString({ message: '差异描述必须是字符串' })
  description: string;

  @ApiProperty({ example: 100, description: '账面金额' })
  @IsNumber({}, { message: '账面金额必须是数字' })
  bookAmount: number;

  @ApiProperty({ example: 98, description: '实际金额' })
  @IsNumber({}, { message: '实际金额必须是数字' })
  actualAmount: number;

  @ApiProperty({ example: -2, description: '差异金额' })
  @IsNumber({}, { message: '差异金额必须是数字' })
  difference: number;

  @ApiPropertyOptional({ example: '平台手续费', description: '差异备注' })
  @IsOptional()
  @IsString({ message: '差异备注必须是字符串' })
  note?: string;
}

export class FinanceReconciliationRecordResponseDto {
  @ApiProperty({ example: '1', description: '对账单 ID' })
  @IsString({ message: '对账单 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '5月月度对账', description: '标题' })
  @IsString({ message: '标题必须是字符串' })
  title: string;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_TYPE_VALUES,
    description: '对账类型',
  })
  @IsIn(FINANCE_RECONCILIATION_TYPE_VALUES, { message: '对账类型不合法' })
  type: FinanceReconciliationTypeValue;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_STATUS_VALUES,
    description: '对账状态',
  })
  @IsIn(FINANCE_RECONCILIATION_STATUS_VALUES, { message: '对账状态不合法' })
  status: FinanceReconciliationStatusValue;

  @ApiPropertyOptional({
    enum: FINANCE_PAYMENT_CHANNEL_VALUES,
    description: '渠道',
  })
  @IsOptional()
  @IsIn(FINANCE_PAYMENT_CHANNEL_VALUES, { message: '渠道不合法' })
  channel?: FinancePaymentChannelValue;

  @ApiPropertyOptional({ example: '绿色蔬菜批发行', description: '对账对象' })
  @IsOptional()
  @IsString({ message: '对账对象必须是字符串' })
  counterpart?: string;

  @ApiProperty({ example: 1746057600000, description: '周期开始时间戳（ms）' })
  @IsInt({ message: '周期开始时间必须是整数' })
  periodStart: number;

  @ApiProperty({ example: 1748735999999, description: '周期结束时间戳（ms）' })
  @IsInt({ message: '周期结束时间必须是整数' })
  periodEnd: number;

  @ApiProperty({ example: 12000, description: '账面收入' })
  @IsNumber({}, { message: '账面收入必须是数字' })
  bookIncome: number;

  @ApiProperty({ example: 8000, description: '账面支出' })
  @IsNumber({}, { message: '账面支出必须是数字' })
  bookExpense: number;

  @ApiProperty({ example: 4000, description: '账面净额' })
  @IsNumber({}, { message: '账面净额必须是数字' })
  bookNet: number;

  @ApiProperty({ example: 11800, description: '实际收入' })
  @IsNumber({}, { message: '实际收入必须是数字' })
  actualIncome: number;

  @ApiProperty({ example: 8100, description: '实际支出' })
  @IsNumber({}, { message: '实际支出必须是数字' })
  actualExpense: number;

  @ApiProperty({ example: 3700, description: '实际净额' })
  @IsNumber({}, { message: '实际净额必须是数字' })
  actualNet: number;

  @ApiProperty({ example: -300, description: '差异金额' })
  @IsNumber({}, { message: '差异金额必须是数字' })
  diffAmount: number;

  @ApiProperty({
    type: [FinanceReconciliationItemResponseDto],
    description: '差异明细',
  })
  @IsArray({ message: '差异明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReconciliationItemResponseDto)
  items: FinanceReconciliationItemResponseDto[];

  @ApiPropertyOptional({ example: '微信手续费差额', description: '调整说明' })
  @IsOptional()
  @IsString({ message: '调整说明必须是字符串' })
  adjustNote?: string;

  @ApiPropertyOptional({ example: '财务张姐', description: '对账人' })
  @IsOptional()
  @IsString({ message: '对账人必须是字符串' })
  operator?: string;

  @ApiPropertyOptional({ example: '节假日汇总', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '对账日期时间戳（ms）' })
  @IsInt({ message: '对账日期必须是整数' })
  date: number;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiProperty({ example: 1747190000000, description: '更新时间戳（ms）' })
  @IsInt({ message: '更新时间必须是整数' })
  updatedAt: number;
}

export class FinanceReconciliationStatsDto {
  @ApiProperty({ example: 8, description: '总对账单数' })
  @IsInt({ message: '总对账单数必须是整数' })
  totalCount: number;

  @ApiProperty({ example: 3, description: '已核实数' })
  @IsInt({ message: '已核实数必须是整数' })
  confirmedCount: number;

  @ApiProperty({ example: 2, description: '有差异数' })
  @IsInt({ message: '有差异数必须是整数' })
  discrepancyCount: number;

  @ApiProperty({ example: 1, description: '已调整数' })
  @IsInt({ message: '已调整数必须是整数' })
  adjustedCount: number;

  @ApiProperty({ example: 2, description: '草稿数' })
  @IsInt({ message: '草稿数必须是整数' })
  draftCount: number;

  @ApiProperty({ example: 628, description: '累计差异总额' })
  @IsNumber({}, { message: '累计差异总额必须是数字' })
  totalDiffAmount: number;

  @ApiProperty({ example: 4, description: '本月新增数' })
  @IsInt({ message: '本月新增数必须是整数' })
  newThisMonth: number;
}

export class PaginatedFinanceReconciliationsResponseDto {
  @ApiProperty({
    type: [FinanceReconciliationRecordResponseDto],
    description: '当前页对账单列表',
  })
  @IsArray({ message: '对账单列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReconciliationRecordResponseDto)
  items: FinanceReconciliationRecordResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}
