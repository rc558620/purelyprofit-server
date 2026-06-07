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

export class FinanceCompareDto {
  @ApiProperty({ example: 1280, description: '当前值' })
  @IsNumber({}, { message: '当前值必须是数字' })
  current: number;

  @ApiProperty({ example: 960, description: '上期值' })
  @IsNumber({}, { message: '上期值必须是数字' })
  previous: number;

  @ApiPropertyOptional({
    example: 33.33,
    description: '变化率 %，上期为 0 时为空',
  })
  @IsOptional()
  @IsNumber({}, { message: '变化率必须是数字' })
  changeRate: number | null;
}

export class FinanceHeroSummaryDto {
  @ApiProperty({ type: FinanceCompareDto, description: '净收益' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  netIncome: FinanceCompareDto;

  @ApiProperty({ type: FinanceCompareDto, description: '总收入' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  totalIncome: FinanceCompareDto;

  @ApiProperty({ type: FinanceCompareDto, description: '总支出' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  totalExpense: FinanceCompareDto;

  @ApiProperty({ type: FinanceCompareDto, description: '利润率' })
  @ValidateNested()
  @Type(() => FinanceCompareDto)
  profitRate: FinanceCompareDto;

  @ApiPropertyOptional({ example: 1.28, description: '收支比' })
  @IsOptional()
  @IsNumber({}, { message: '收支比必须是数字' })
  incomeExpenseRatio: number | null;
}

export class FinanceDailyTrendDto {
  @ApiProperty({ example: '05/14', description: '日期标签' })
  @IsString({ message: '日期标签必须是字符串' })
  dateLabel: string;

  @ApiProperty({ example: 420.5, description: '收入' })
  @IsNumber({}, { message: '收入必须是数字' })
  income: number;

  @ApiProperty({ example: 260.5, description: '支出' })
  @IsNumber({}, { message: '支出必须是数字' })
  expense: number;

  @ApiProperty({ example: 160, description: '净收益' })
  @IsNumber({}, { message: '净收益必须是数字' })
  net: number;
}

export class FinanceSourceItemDto {
  @ApiProperty({
    enum: ['sales', 'additional', 'cost', 'purchase'],
    description: '来源类型',
  })
  @IsString({ message: '来源类型必须是字符串' })
  type: 'sales' | 'additional' | 'cost' | 'purchase';

  @ApiProperty({ example: '销售收入', description: '来源名称' })
  @IsString({ message: '来源名称必须是字符串' })
  label: string;

  @ApiProperty({ example: 8800, description: '金额' })
  @IsNumber({}, { message: '金额必须是数字' })
  amount: number;

  @ApiProperty({ enum: ['income', 'expense'], description: '收支方向' })
  @IsIn(['income', 'expense'], { message: '收支方向不合法' })
  direction: 'income' | 'expense';

  @ApiProperty({ example: '#84cc16', description: '颜色' })
  @IsString({ message: '颜色必须是字符串' })
  color: string;

  @ApiProperty({ example: '🛒', description: '图标' })
  @IsString({ message: '图标必须是字符串' })
  icon: string;

  @ApiProperty({ example: 65, description: '占比整数百分比' })
  @IsInt({ message: '占比必须是整数' })
  percent: number;
}

export class FinanceSourceGroupDto {
  @ApiProperty({ enum: ['income', 'expense'], description: '分组方向' })
  @IsIn(['income', 'expense'], { message: '分组方向不合法' })
  direction: 'income' | 'expense';

  @ApiProperty({ example: 12800, description: '该方向总额' })
  @IsNumber({}, { message: '总额必须是数字' })
  total: number;

  @ApiProperty({ type: [FinanceSourceItemDto], description: '来源项列表' })
  @IsArray({ message: '来源项列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => FinanceSourceItemDto)
  items: FinanceSourceItemDto[];
}
