import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type { TransformFnParams } from 'class-transformer';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMinSize,
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
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalInt,
} from '../../stores/dto/store-response.dto';
import {
  PURCHASE_PERIOD_VALUES,
  type PurchasePeriodValue,
} from '../../commerce/commerce.utils';

function transformOptionalPurchaseProductId({
  value,
}: TransformFnParams): number | undefined {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();
    if (trimmedValue === '') {
      return undefined;
    }
    if (/^-?\d+$/.test(trimmedValue)) {
      return Number.parseInt(trimmedValue, 10);
    }
    if (/[A-Za-z_-]/.test(trimmedValue)) {
      return undefined;
    }
  }

  return Number.NaN;
}

export class PurchaseItemInputDto {
  @ApiPropertyOptional({
    example: 1,
    description: '商品 ID，无码商品可不传；前端临时商品 ID 会自动忽略',
  })
  @IsOptional()
  @Transform(transformOptionalPurchaseProductId)
  @IsInt({ message: '商品 ID 必须是整数' })
  @Min(1, { message: '商品 ID 必须大于等于 1' })
  productId?: number;

  @ApiPropertyOptional({
    example: '可口可乐 330ml',
    description: '商品名称快照，不传时以后端商品名称为准',
  })
  @IsOptional()
  @IsString({ message: '商品名称必须是字符串' })
  @MaxLength(100, { message: '商品名称最长 100 个字符' })
  productName?: string;

  @ApiPropertyOptional({ example: '箱', description: '单位快照' })
  @IsOptional()
  @IsString({ message: '单位必须是字符串' })
  @MaxLength(20, { message: '单位最长 20 个字符' })
  unit?: string;

  @ApiProperty({ example: 5, description: '进货数量' })
  @Type(() => Number)
  @IsInt({ message: '进货数量必须是整数' })
  @Min(1, { message: '进货数量必须大于 0' })
  quantity: number;

  @ApiProperty({ example: 60, description: '进货单价（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '进货单价必须是数字' })
  @Min(0, { message: '进货单价不能为负数' })
  unitPrice: number;

  @ApiPropertyOptional({
    example: 300,
    description: '前端计算的小计金额（元），后端会重新校验并以服务端计算为准',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '小计金额必须是数字' })
  @Min(0, { message: '小计金额不能为负数' })
  amount?: number;
}

export class CreatePurchaseDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({ example: 1, description: '供应商 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '供应商 ID 必须是整数' })
  @Min(1, { message: '供应商 ID 必须大于等于 1' })
  supplierId?: number;

  @ApiPropertyOptional({ example: '张老板批发', description: '手输供应商名称' })
  @IsOptional()
  @IsString({ message: '供应商名称必须是字符串' })
  @MaxLength(30, { message: '供应商名称最长 30 个字符' })
  supplierName?: string;

  @ApiProperty({ type: [PurchaseItemInputDto], description: '进货明细' })
  @IsArray({ message: '进货明细必须是数组' })
  @ArrayMinSize(1, { message: '请至少填写一条商品明细' })
  @ValidateNested({ each: true })
  @Type(() => PurchaseItemInputDto)
  items: PurchaseItemInputDto[];

  @ApiPropertyOptional({
    example: 520,
    description: '前端计算的总金额（元），后端会重新校验并以服务端计算为准',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({}, { message: '总金额必须是数字' })
  @Min(0, { message: '总金额不能为负数' })
  totalAmount?: number;

  @ApiProperty({
    example: 1715558400000,
    description: '进货日期时间戳（毫秒）',
  })
  @Type(() => Number)
  @IsInt({ message: '进货日期必须是整数时间戳' })
  @Min(0, { message: '进货日期不合法' })
  date: number;

  @ApiPropertyOptional({ example: '货款月结', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最长 100 个字符' })
  note?: string;
}

export class ListPurchasesQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 'month',
    enum: PURCHASE_PERIOD_VALUES,
    description: '时间周期筛选',
  })
  @IsOptional()
  @IsIn(PURCHASE_PERIOD_VALUES, { message: '时间周期不合法' })
  period?: PurchasePeriodValue;

  @ApiPropertyOptional({
    example: 1715558400000,
    description: '自定义单日时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1715558400000,
    description: '区间开始时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1715644799999,
    description: '区间结束时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;
}

export class PurchaseStatsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 'month',
    enum: PURCHASE_PERIOD_VALUES,
    description: '时间周期筛选',
  })
  @IsOptional()
  @IsIn(PURCHASE_PERIOD_VALUES, { message: '时间周期不合法' })
  period?: PurchasePeriodValue;

  @ApiPropertyOptional({
    example: 1715558400000,
    description: '自定义单日时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '自定义日期必须是整数时间戳' })
  @Min(0, { message: '自定义日期不合法' })
  customDate?: number;

  @ApiPropertyOptional({
    example: 1715558400000,
    description: '区间开始时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1715644799999,
    description: '区间结束时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;
}

export class PurchaseItemResponseDto {
  @ApiProperty({ example: '1', description: '明细 ID' })
  id: string;

  @ApiPropertyOptional({ example: '1', description: '商品 ID，无码商品不返回' })
  productId?: string;

  @ApiProperty({ example: '可口可乐 330ml', description: '商品名称' })
  productName: string;

  @ApiPropertyOptional({ example: '箱', description: '单位' })
  unit?: string;

  @ApiProperty({ example: 5, description: '进货数量' })
  quantity: number;

  @ApiProperty({ example: 60, description: '进货单价（元）' })
  unitPrice: number;

  @ApiProperty({ example: 300, description: '小计金额（元）' })
  amount: number;
}

export class PurchaseResponseDto {
  @ApiProperty({ example: '1', description: '进货单 ID' })
  id: string;

  @ApiPropertyOptional({ example: '1', description: '供应商 ID' })
  supplierId?: string;

  @ApiPropertyOptional({ example: '张老板批发', description: '供应商名称快照' })
  supplierName?: string;

  @ApiProperty({ type: [PurchaseItemResponseDto], description: '进货明细' })
  items: PurchaseItemResponseDto[];

  @ApiProperty({ example: 520, description: '总金额（元）' })
  totalAmount: number;

  @ApiProperty({
    example: 1715558400000,
    description: '进货日期时间戳（毫秒）',
  })
  date: number;

  @ApiPropertyOptional({ example: '货款月结', description: '备注' })
  note?: string;

  @ApiProperty({ example: 1715560000000, description: '创建时间戳（毫秒）' })
  createdAt: number;
}

export class PaginatedPurchasesResponseDto {
  @ApiProperty({ type: [PurchaseResponseDto], description: '进货单列表' })
  items: PurchaseResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  meta: PaginationMetaDto;
}

export class PurchaseStatsResponseDto {
  @ApiProperty({ example: 5200, description: '当前筛选周期总进货金额' })
  totalThisMonth: number;

  @ApiProperty({ example: 12, description: '当前筛选周期进货笔数' })
  countThisMonth: number;

  @ApiProperty({ example: 8, description: '供应商总数' })
  supplierCount: number;

  @ApiPropertyOptional({
    example: 12.5,
    description: '较上一周期变化百分比；无对比数据时为 null',
  })
  compareLastMonth: number | null;
}
