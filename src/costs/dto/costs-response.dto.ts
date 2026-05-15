import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { COST_SOURCE_TYPE_VALUES } from '../costs.types';

export class CostRecordResponseDto {
  @ApiProperty({ example: '1', description: '成本记录 ID' })
  @IsString({ message: '成本记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '门店房租', description: '成本名称' })
  @IsString({ message: '成本名称必须是字符串' })
  title: string;

  @ApiProperty({ enum: ['fixed', 'variable'], description: '成本类型' })
  @IsString({ message: '成本类型必须是字符串' })
  type: 'fixed' | 'variable';

  @ApiProperty({
    enum: [
      'rent',
      'salary',
      'insurance',
      'provident_fund',
      'utilities',
      'purchase',
      'equipment',
      'marketing',
      'packaging',
      'other',
    ],
    description: '成本分类',
  })
  @IsString({ message: '成本分类必须是字符串' })
  category:
    | 'rent'
    | 'salary'
    | 'insurance'
    | 'provident_fund'
    | 'utilities'
    | 'purchase'
    | 'equipment'
    | 'marketing'
    | 'packaging'
    | 'other';

  @ApiProperty({ example: 1888.5, description: '金额，单位元' })
  @IsNumber({}, { message: '金额必须是数字' })
  amount: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（毫秒）' })
  @IsInt({ message: '发生时间必须是整数时间戳' })
  date: number;

  @ApiPropertyOptional({ example: '每月固定房租', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;

  @ApiProperty({
    enum: COST_SOURCE_TYPE_VALUES,
    description: '成本来源类型，manual 表示手动新增，其余为自动沉淀',
  })
  @IsString({ message: '成本来源类型必须是字符串' })
  sourceType:
    | 'manual'
    | 'purchase'
    | 'payroll_salary'
    | 'payroll_insurance'
    | 'payroll_provident_fund';

  @ApiProperty({
    example: true,
    description: '是否允许手动删除，自动沉淀记录为 false',
  })
  @IsBoolean({ message: '可删除标记必须是布尔值' })
  deletable: boolean;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳（毫秒）' })
  @IsInt({ message: '创建时间必须是整数时间戳' })
  createdAt: number;
}

export class CostReportSummaryDto {
  @ApiProperty({ example: 12880, description: '当前筛选周期总支出' })
  @IsNumber({}, { message: '当前总支出必须是数字' })
  total: number;

  @ApiProperty({ example: 5200, description: '当前筛选周期固定支出' })
  @IsNumber({}, { message: '固定支出必须是数字' })
  fixed: number;

  @ApiProperty({ example: 7680, description: '当前筛选周期变动支出' })
  @IsNumber({}, { message: '变动支出必须是数字' })
  variable: number;

  @ApiProperty({ example: 16, description: '当前筛选周期记录条数' })
  @IsInt({ message: '记录条数必须是整数' })
  recordCount: number;

  @ApiPropertyOptional({
    example: 18.6,
    description: '较上期变化 %，上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber({}, { message: '较上期变化必须是数字' })
  compareLastPeriod: number | null;
}

export class CostReportCategoryRowDto {
  @ApiProperty({ example: '租金', description: '分类标签' })
  @IsString({ message: '分类标签必须是字符串' })
  label: string;

  @ApiProperty({ example: 5200, description: '分类金额' })
  @IsNumber({}, { message: '分类金额必须是数字' })
  amount: number;

  @ApiProperty({ example: 40.37, description: '分类占比（%）' })
  @IsNumber({}, { message: '分类占比必须是数字' })
  percentage: number;

  @ApiProperty({ example: '#6366f1', description: '分类颜色' })
  @IsString({ message: '分类颜色必须是字符串' })
  color: string;
}

export class CostReportDetailRowDto {
  @ApiProperty({ example: '1', description: '明细行 ID' })
  @IsString({ message: '明细行 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '门店房租', description: '明细标题' })
  @IsString({ message: '明细标题必须是字符串' })
  title: string;

  @ApiProperty({ example: 5200, description: '明细金额' })
  @IsNumber({}, { message: '明细金额必须是数字' })
  amount: number;

  @ApiProperty({ example: 1747180800000, description: '发生时间戳（毫秒）' })
  @IsInt({ message: '发生时间必须是整数时间戳' })
  date: number;

  @ApiProperty({ example: '2026/05/14', description: '格式化日期标签' })
  @IsString({ message: '日期标签必须是字符串' })
  dateLabel: string;

  @ApiPropertyOptional({ example: '每月固定房租', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  note?: string;
}

export class CostReportResponseDto {
  @ApiProperty({ type: CostReportSummaryDto, description: '成本报表概况' })
  @ValidateNested()
  @Type(() => CostReportSummaryDto)
  summary: CostReportSummaryDto;

  @ApiProperty({ type: [CostReportCategoryRowDto], description: '成本分类汇总' })
  @IsArray({ message: '成本分类汇总必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CostReportCategoryRowDto)
  categories: CostReportCategoryRowDto[];

  @ApiProperty({ type: [CostReportDetailRowDto], description: '当前分类对应的成本明细' })
  @IsArray({ message: '成本明细必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CostReportDetailRowDto)
  detailRows: CostReportDetailRowDto[];
}

export class CostStatsResponseDto {
  @ApiProperty({ example: 12880, description: '当前筛选周期总支出' })
  @IsNumber({}, { message: '当前总支出必须是数字' })
  total: number;

  @ApiProperty({ example: 5200, description: '当前筛选周期固定支出' })
  @IsNumber({}, { message: '固定支出必须是数字' })
  fixed: number;

  @ApiProperty({ example: 7680, description: '当前筛选周期变动支出' })
  @IsNumber({}, { message: '变动支出必须是数字' })
  variable: number;

  @ApiPropertyOptional({
    example: 18.6,
    description: '较上期变化 %，上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber({}, { message: '较上期变化必须是数字' })
  compareLastPeriod: number | null;

  @ApiProperty({ example: 16, description: '当前筛选周期记录条数' })
  @IsInt({ message: '记录条数必须是整数' })
  recordCount: number;
}
