import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PaginationQueryDto } from '../../stores/dto/store-response.dto';
import {
  FINANCE_PAYMENT_CHANNEL_VALUES,
  FINANCE_RECONCILIATION_STATUS_VALUES,
  FINANCE_RECONCILIATION_STATUS_FILTER_VALUES,
  FINANCE_RECONCILIATION_TYPE_VALUES,
  FINANCE_RECONCILIATION_TYPE_FILTER_VALUES,
  type FinancePaymentChannelValue,
  type FinanceReconciliationStatusValue,
  type FinanceReconciliationTypeValue,
} from '../finance.types';

export class FinanceReconciliationItemInputDto {
  @ApiProperty({ example: '微信渠道差异', description: '差异项目描述' })
  @IsString({ message: '差异描述必须是字符串' })
  description: string;

  @ApiProperty({ example: 100, description: '账面金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '账面金额必须是数字' })
  bookAmount: number;

  @ApiProperty({ example: 98, description: '实际金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '实际金额必须是数字' })
  actualAmount: number;

  @ApiPropertyOptional({ example: '手续费差异', description: '备注' })
  @IsOptional()
  @IsString({ message: '差异备注必须是字符串' })
  @MaxLength(100, { message: '差异备注最多 100 个字符' })
  note?: string;
}

export class ListFinanceReconciliationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_RECONCILIATION_STATUS_FILTER_VALUES,
    description: '对账状态筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_RECONCILIATION_STATUS_FILTER_VALUES, {
    message: '对账状态筛选不合法',
  })
  statusFilter?: 'all' | FinanceReconciliationStatusValue;

  @ApiPropertyOptional({
    enum: FINANCE_RECONCILIATION_TYPE_FILTER_VALUES,
    description: '对账类型筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_RECONCILIATION_TYPE_FILTER_VALUES, {
    message: '对账类型筛选不合法',
  })
  typeFilter?: 'all' | FinanceReconciliationTypeValue;

  @ApiPropertyOptional({
    example: '供应商',
    description: '标题/对象/备注搜索词',
  })
  @IsOptional()
  @IsString({ message: '搜索词必须是字符串' })
  @MaxLength(30, { message: '搜索词最多 30 个字符' })
  searchText?: string;
}

export class CreateFinanceReconciliationDto {
  @ApiProperty({ example: '5月月度对账', description: '对账标题' })
  @IsString({ message: '对账标题必须是字符串' })
  @MaxLength(50, { message: '对账标题最多 50 个字符' })
  title: string;

  @ApiProperty({
    enum: FINANCE_RECONCILIATION_TYPE_VALUES,
    description: '对账类型',
  })
  @IsIn(FINANCE_RECONCILIATION_TYPE_VALUES, { message: '对账类型不合法' })
  type: FinanceReconciliationTypeValue;

  @ApiPropertyOptional({
    enum: FINANCE_PAYMENT_CHANNEL_VALUES,
    description: '收款渠道，仅 payment 类型有效',
  })
  @IsOptional()
  @IsIn(FINANCE_PAYMENT_CHANNEL_VALUES, { message: '收款渠道不合法' })
  channel?: FinancePaymentChannelValue;

  @ApiPropertyOptional({ example: '绿色蔬菜批发行', description: '对账对象' })
  @IsOptional()
  @IsString({ message: '对账对象必须是字符串' })
  @MaxLength(30, { message: '对账对象最多 30 个字符' })
  counterpart?: string;

  @ApiProperty({ example: 1746057600000, description: '周期开始时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '周期开始时间必须是整数时间戳' })
  periodStart: number;

  @ApiProperty({ example: 1748735999999, description: '周期结束时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '周期结束时间必须是整数时间戳' })
  periodEnd: number;

  @ApiProperty({ example: 12000, description: '账面收入，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '账面收入必须是数字' })
  @Min(0, { message: '账面收入不能小于 0' })
  bookIncome: number;

  @ApiProperty({ example: 8000, description: '账面支出，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '账面支出必须是数字' })
  @Min(0, { message: '账面支出不能小于 0' })
  bookExpense: number;

  @ApiPropertyOptional({
    example: 11800,
    description: '实际收入，单位元；null 或不传表示未录入（草稿）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '实际收入必须是数字' })
  @Min(0, { message: '实际收入不能小于 0' })
  actualIncome?: number | null;

  @ApiPropertyOptional({
    example: 8100,
    description: '实际支出，单位元；null 或不传表示未录入（草稿）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '实际支出必须是数字' })
  @Min(0, { message: '实际支出不能小于 0' })
  actualExpense?: number | null;

  @ApiPropertyOptional({
    type: [FinanceReconciliationItemInputDto],
    description: '差异明细',
  })
  @IsOptional()
  @IsArray({ message: '差异明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceReconciliationItemInputDto)
  items?: FinanceReconciliationItemInputDto[];

  @ApiPropertyOptional({ example: '财务张姐', description: '对账人' })
  @IsOptional()
  @IsString({ message: '对账人必须是字符串' })
  @MaxLength(20, { message: '对账人最多 20 个字符' })
  operator?: string;

  @ApiPropertyOptional({ example: '节假日汇总', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;

  @ApiProperty({ example: 1747180800000, description: '对账日期时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '对账日期必须是整数时间戳' })
  date: number;
}

export class ConfirmFinanceReconciliationDto {
  @ApiPropertyOptional({ example: '微信手续费差额', description: '调整说明' })
  @IsOptional()
  @IsString({ message: '调整说明必须是字符串' })
  @MaxLength(150, { message: '调整说明最多 150 个字符' })
  adjustNote?: string;
}
