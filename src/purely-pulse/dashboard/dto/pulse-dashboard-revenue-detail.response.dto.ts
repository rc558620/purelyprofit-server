import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsString, ValidateNested } from 'class-validator';
import {
  PulseDashboardRevenueSummaryDto,
  PulseDashboardRevenueTrendDto,
  PulseDashboardRevenueTypeItemDto,
} from './pulse-dashboard-home.response.dto';

export class PulseRevenueDetailRecordDto {
  @ApiProperty({ example: 'order-21', description: '充值记录 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '刘梅', description: '充值用户展示名' })
  @IsString()
  user: string;

  @ApiProperty({ example: '季度会员', description: '充值类型' })
  @IsString()
  type: string;

  @ApiProperty({ example: 9900, description: '充值金额（分）' })
  @IsInt()
  amount: number;

  @ApiProperty({ example: '310000 · 310100 · 310104', description: '地区文案' })
  @IsString()
  region: string;

  @ApiProperty({ example: '09:30', description: '充值时间（HH:mm）' })
  @IsString()
  time: string;
}

export class PulseRevenueDetailResponseDto {
  @ApiProperty({
    type: PulseDashboardRevenueTrendDto,
    description: '充值收入趋势数据',
  })
  @ValidateNested()
  @Type(() => PulseDashboardRevenueTrendDto)
  revenueTrend: PulseDashboardRevenueTrendDto;

  @ApiProperty({
    type: PulseDashboardRevenueSummaryDto,
    description: '充值收入汇总数据',
  })
  @ValidateNested()
  @Type(() => PulseDashboardRevenueSummaryDto)
  revenueSummary: PulseDashboardRevenueSummaryDto;

  @ApiProperty({
    type: [PulseDashboardRevenueTypeItemDto],
    description: '充值类型占比',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseDashboardRevenueTypeItemDto)
  revenueTypeBreakdown: PulseDashboardRevenueTypeItemDto[];

  @ApiProperty({
    type: [PulseRevenueDetailRecordDto],
    description: '充值记录列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseRevenueDetailRecordDto)
  records: PulseRevenueDetailRecordDto[];

  @ApiProperty({ example: 28, description: '充值记录总数' })
  @IsInt()
  totalRecords: number;

  @ApiProperty({ example: 1747212600000, description: '接口生成时间戳（ms）' })
  @IsInt()
  generatedAt: number;
}
