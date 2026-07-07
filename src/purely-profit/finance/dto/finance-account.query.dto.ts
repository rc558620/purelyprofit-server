import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PaginationQueryDto } from '../../stores/dto/store-response.dto';
import {
  FINANCE_ACCOUNT_CATEGORY_VALUES,
  FINANCE_ACCOUNT_STATUS_FILTER_VALUES,
  FINANCE_ACCOUNT_TYPE_FILTER_VALUES,
  FINANCE_ACCOUNT_TYPE_VALUES,
  type FinanceAccountCategoryValue,
  type FinanceAccountTypeValue,
} from '../finance.types';

export class ListFinanceAccountsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    enum: FINANCE_ACCOUNT_TYPE_FILTER_VALUES,
    description: '账款类型筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_ACCOUNT_TYPE_FILTER_VALUES, { message: '账款类型筛选不合法' })
  typeFilter?: 'all' | FinanceAccountTypeValue;

  @ApiPropertyOptional({
    enum: FINANCE_ACCOUNT_STATUS_FILTER_VALUES,
    description: '账款状态筛选',
  })
  @IsOptional()
  @IsIn(FINANCE_ACCOUNT_STATUS_FILTER_VALUES, { message: '账款状态筛选不合法' })
  statusFilter?: 'all' | 'pending' | 'partial' | 'settled' | 'overdue';

  @ApiPropertyOptional({
    example: '蔬菜批发行',
    description: '对方名称/备注搜索词',
  })
  @IsOptional()
  @IsString({ message: '搜索词必须是字符串' })
  @MaxLength(30, { message: '搜索词最多 30 个字符' })
  searchText?: string;

  @ApiPropertyOptional({
    enum: ['all', 'custom_day', 'custom_range'],
    description: '日期范围筛选模式',
  })
  @IsOptional()
  @IsIn(['all', 'custom_day', 'custom_range'], {
    message: '日期筛选模式不合法',
  })
  datePeriod?: 'all' | 'custom_day' | 'custom_range';

  @ApiPropertyOptional({ example: 2026, description: '自定义单天-年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单天年份必须是整数' })
  @Min(2000, { message: '年份不能小于 2000' })
  @Max(2100, { message: '年份不能大于 2100' })
  customDayYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义单天-月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单天月份必须是整数' })
  @Min(1)
  @Max(12)
  customDayMonth?: number;

  @ApiPropertyOptional({ example: 18, description: '自定义单天-日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '自定义单天日期必须是整数' })
  @Min(1)
  @Max(31)
  customDayDay?: number;

  @ApiPropertyOptional({ example: 2026, description: '自定义区间-起始年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '起始年份必须是整数' })
  customRangeStartYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义区间-起始月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '起始月份必须是整数' })
  customRangeStartMonth?: number;

  @ApiPropertyOptional({ example: 1, description: '自定义区间-起始日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '起始日期必须是整数' })
  customRangeStartDay?: number;

  @ApiPropertyOptional({ example: 2026, description: '自定义区间-结束年' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '结束年份必须是整数' })
  customRangeEndYear?: number;

  @ApiPropertyOptional({ example: 5, description: '自定义区间-结束月' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '结束月份必须是整数' })
  customRangeEndMonth?: number;

  @ApiPropertyOptional({ example: 31, description: '自定义区间-结束日' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '结束日期必须是整数' })
  customRangeEndDay?: number;
}

export class CreateFinanceAccountDto {
  @ApiProperty({
    enum: FINANCE_ACCOUNT_TYPE_VALUES,
    description: '账款类型',
  })
  @IsIn(FINANCE_ACCOUNT_TYPE_VALUES, { message: '账款类型不合法' })
  type: FinanceAccountTypeValue;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_CATEGORY_VALUES,
    description:
      '账款分类：sales_credit 强绑定应收；supplier_debt 强绑定应付；advance_paid/loan/deposit/other 允许按实际业务选择应收或应付',
  })
  @IsIn(FINANCE_ACCOUNT_CATEGORY_VALUES, { message: '账款分类不合法' })
  category: FinanceAccountCategoryValue;

  @ApiProperty({ example: '张三水果店', description: '对方名称' })
  @IsString({ message: '对方名称必须是字符串' })
  @IsNotEmpty({ message: '对方名称不能为空' })
  @MaxLength(30, { message: '对方名称最多 30 个字符' })
  counterpart: string;

  @ApiProperty({ example: 5000, description: '总金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '总金额必须是数字' })
  @Min(0.01, { message: '总金额必须大于 0' })
  amount: number;

  @ApiProperty({ example: 0, description: '已收/付金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '已收/付金额必须是数字' })
  @Min(0, { message: '已收/付金额不能小于 0' })
  paidAmount: number;

  @ApiPropertyOptional({
    example: 1747267200000,
    description: '到期时间戳（ms）',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '到期时间必须是整数时间戳' })
  dueDate?: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @Type(() => Number)
  @IsInt({ message: '发生时间必须是整数时间戳' })
  date: number;

  @ApiPropertyOptional({ example: '分两次结清', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 个字符' })
  note?: string;
}

export class SettleFinanceAccountDto {
  @ApiProperty({ example: 1000, description: '本次收/付金额，单位元' })
  @Type(() => Number)
  @IsNumber({}, { message: '本次收付金额必须是数字' })
  @Min(0.01, { message: '本次收付金额必须大于 0' })
  payAmount: number;
}
