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
  FINANCE_ACCOUNT_CATEGORY_VALUES,
  FINANCE_ACCOUNT_STATUS_VALUES,
  FINANCE_ACCOUNT_TYPE_VALUES,
  type FinanceAccountCategoryValue,
  type FinanceAccountStatusValue,
  type FinanceAccountTypeValue,
} from '../finance.types';

export class FinanceAccountRecordResponseDto {
  @ApiProperty({ example: '1', description: '账款 ID' })
  @IsString({ message: '账款 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_TYPE_VALUES,
    description: '账款类型',
  })
  @IsIn(FINANCE_ACCOUNT_TYPE_VALUES, { message: '账款类型不合法' })
  type: FinanceAccountTypeValue;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_CATEGORY_VALUES,
    description:
      '账款分类：sales_credit 为客户赊账应收；supplier_debt 为供应商欠款应付；advance_paid/loan/deposit/other 可按业务场景落为应收或应付',
  })
  @IsIn(FINANCE_ACCOUNT_CATEGORY_VALUES, { message: '账款分类不合法' })
  category: FinanceAccountCategoryValue;

  @ApiProperty({ example: '张三水果店', description: '对方名称' })
  @IsString({ message: '对方名称必须是字符串' })
  counterpart: string;

  @ApiProperty({ example: 5200, description: '总金额，单位元' })
  @IsNumber({}, { message: '总金额必须是数字' })
  amount: number;

  @ApiProperty({ example: 1200, description: '已收/付金额，单位元' })
  @IsNumber({}, { message: '已收/付金额必须是数字' })
  paidAmount: number;

  @ApiProperty({ example: 4000, description: '剩余金额，单位元' })
  @IsNumber({}, { message: '剩余金额必须是数字' })
  remaining: number;

  @ApiProperty({
    enum: FINANCE_ACCOUNT_STATUS_VALUES,
    description: '账款状态',
  })
  @IsIn(FINANCE_ACCOUNT_STATUS_VALUES, { message: '账款状态不合法' })
  status: FinanceAccountStatusValue;

  @ApiPropertyOptional({
    example: 1747267200000,
    description: '到期时间戳（ms）',
  })
  @IsOptional()
  @IsInt({ message: '到期时间必须是整数' })
  dueDate?: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（ms）' })
  @IsInt({ message: '发生时间必须是整数' })
  date: number;

  @ApiPropertyOptional({ example: '月底前结清', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（ms）' })
  @IsInt({ message: '创建时间必须是整数' })
  createdAt: number;

  @ApiProperty({ example: 1747190000000, description: '更新时间戳（ms）' })
  @IsInt({ message: '更新时间必须是整数' })
  updatedAt: number;
}

export class FinanceAccountsStatsDto {
  @ApiProperty({ example: 8200, description: '应收总额' })
  @IsNumber({}, { message: '应收总额必须是数字' })
  totalReceivable: number;

  @ApiProperty({ example: 2600, description: '应付总额' })
  @IsNumber({}, { message: '应付总额必须是数字' })
  totalPayable: number;

  @ApiProperty({ example: 5600, description: '净应收' })
  @IsNumber({}, { message: '净应收必须是数字' })
  netReceivable: number;

  @ApiProperty({ example: 2, description: '逾期条数' })
  @IsInt({ message: '逾期条数必须是整数' })
  overdueCount: number;

  @ApiProperty({ example: 4, description: '本月新增条数' })
  @IsInt({ message: '本月新增条数必须是整数' })
  newThisMonth: number;
}

export class PaginatedFinanceAccountsResponseDto {
  @ApiProperty({
    type: [FinanceAccountRecordResponseDto],
    description: '当前页账款列表',
  })
  @IsArray({ message: '账款列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceAccountRecordResponseDto)
  items: FinanceAccountRecordResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}
