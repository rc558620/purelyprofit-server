import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

// ─── 营业详情统计 DTO ─────────────────────────────────────────────────────────

/** 单周期销售/利润数据点（ECharts 柱状图）。 */
export class PulseAdminMemberSalesDataPointDto {
  @ApiProperty({ example: '周一', description: '时间标签' })
  @IsString()
  label: string;

  @ApiProperty({ example: 12800, description: '销售额（分）' })
  @IsInt()
  salesFen: number;

  @ApiProperty({ example: 3200, description: '利润（分）' })
  @IsInt()
  profitFen: number;

  @ApiProperty({
    example: '128',
    description: '销售额展示值（元，后端格式化）',
  })
  @IsString()
  salesDisplay: string;

  @ApiProperty({
    example: '32',
    description: '利润展示值（元，后端格式化）',
  })
  @IsString()
  profitDisplay: string;
}

/** 单维度销售汇总。 */
export class PulseAdminMemberSalesPeriodSummaryDto {
  @ApiProperty({ example: 'today', description: '时间维度' })
  @IsString()
  period: string;

  @ApiProperty({ example: 128800, description: '销售总额（分）' })
  @IsInt()
  totalSalesFen: number;

  @ApiProperty({ example: 32200, description: '利润总额（分）' })
  @IsInt()
  totalProfitFen: number;

  @ApiProperty({
    example: '1288',
    description: '销售总额展示值（元，后端格式化）',
  })
  @IsString()
  totalSalesDisplay: string;

  @ApiProperty({
    example: '322',
    description: '利润总额展示值（元，后端格式化）',
  })
  @IsString()
  totalProfitDisplay: string;

  @ApiPropertyOptional({
    example: 12.5,
    description: '销售额环比增幅（百分比）',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  salesGrowthPct: number | null;

  @ApiPropertyOptional({
    example: 8.3,
    description: '利润环比增幅（百分比）',
    nullable: true,
  })
  @IsOptional()
  @IsNumber()
  profitGrowthPct: number | null;

  @ApiProperty({
    type: [PulseAdminMemberSalesDataPointDto],
    description: '各时间点明细',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberSalesDataPointDto)
  dataPoints: PulseAdminMemberSalesDataPointDto[];
}

/** 商家营业详情统计（owner 视角，含 5 个周期）。 */
export class PulseAdminMemberSalesStatsDto {
  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  today: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  week: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  month: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  year: PulseAdminMemberSalesPeriodSummaryDto;

  @ApiProperty({ type: PulseAdminMemberSalesPeriodSummaryDto })
  @ValidateNested()
  @Type(() => PulseAdminMemberSalesPeriodSummaryDto)
  lastYear: PulseAdminMemberSalesPeriodSummaryDto;
}
