import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import {
  SPACE_STATUS_VALUES,
  type SpaceStatusValue,
} from '../spaces.constants';

export class SpaceResponseDto {
  @ApiProperty({ example: '1', description: '空间 ID' })
  id: string;

  @ApiProperty({ example: 'A台', description: '空间名称' })
  name: string;

  @ApiProperty({ example: '餐桌', description: '空间类型名称' })
  type: string;

  @ApiPropertyOptional({ example: '1楼', description: '空间区域名称' })
  zone?: string;

  @ApiPropertyOptional({ example: 4, description: '容纳人数' })
  capacity?: number;

  @ApiProperty({ example: false, description: '是否开启脏房模式' })
  enableDirtyRoom: boolean;

  @ApiProperty({ example: false, description: '是否默认自动结账' })
  autoCheckout: boolean;

  @ApiProperty({
    example: 'idle',
    description: '空间状态',
    enum: SPACE_STATUS_VALUES,
  })
  status: SpaceStatusValue;

  @ApiProperty({ example: 1, description: '显示顺序' })
  sortOrder: number;

  @ApiProperty({ example: 1715600000000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1715600000000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}

export class SpaceDashboardActiveSessionSummaryDto {
  @ApiProperty({ example: '1', description: '当前活跃会话 ID' })
  sessionId: string;

  @ApiPropertyOptional({ example: '张先生', description: '顾客姓名' })
  guestName?: string;

  @ApiPropertyOptional({ example: '13800138000', description: '顾客电话' })
  guestPhone?: string;

  @ApiPropertyOptional({ example: 4, description: '顾客人数' })
  guestCount?: number;

  @ApiProperty({ example: 'countdown', description: '计费模式' })
  billingMode: string;

  @ApiProperty({ example: 1715691600000, description: '开台时间戳（毫秒）' })
  startTime: number;

  @ApiPropertyOptional({ example: 68, description: '计时单价/台位费（元）' })
  hourlyRate?: number;

  @ApiPropertyOptional({ example: 90, description: '倒计时总时长（分钟）' })
  countdownMinutes?: number;

  @ApiProperty({ example: 36, description: '商品费用合计（元）' })
  itemsCost: number;

  @ApiProperty({ example: 1, description: '续费记录数量' })
  renewCount: number;

  @ApiPropertyOptional({ example: true, description: '倒计时到期是否自动结账' })
  autoCheckout?: boolean;

  @ApiPropertyOptional({
    example: 'cash',
    description: '预付支付方式（自动结账时）',
  })
  prepaidPaymentMethod?: string;

  @ApiPropertyOptional({ example: 'MT123456', description: '预付团购券码' })
  prepaidGrouponCode?: string;

  @ApiPropertyOptional({ example: '美团团购券', description: '预付备注' })
  prepaidNote?: string;

  @ApiPropertyOptional({ example: 88, description: '预付金额（元）' })
  prepaidAmount?: number;
}

export class SpaceDashboardReservationSummaryDto {
  @ApiProperty({ example: '12', description: '预约 ID' })
  reservationId: string;

  @ApiProperty({ example: '李女士', description: '预约人姓名' })
  guestName: string;

  @ApiPropertyOptional({ example: '13800138000', description: '联系方式' })
  phone?: string;

  @ApiPropertyOptional({ example: 2, description: '预约人数' })
  guestCount?: number;

  @ApiProperty({
    example: 1715695200000,
    description: '预约开始时间戳（毫秒）',
  })
  reservedAt: number;

  @ApiPropertyOptional({
    example: 1715698800000,
    description: '预约结束时间戳（毫秒）',
  })
  reservedEndAt?: number;

  @ApiPropertyOptional({ example: false, description: '是否已超时未处理' })
  isOverdue?: boolean;
}

export class SpaceDashboardSpaceItemDto extends SpaceResponseDto {
  @ApiPropertyOptional({
    type: () => SpaceDashboardActiveSessionSummaryDto,
    description: '当前活跃会话摘要',
  })
  @ValidateNested()
  @Type(() => SpaceDashboardActiveSessionSummaryDto)
  activeSessionSummary?: SpaceDashboardActiveSessionSummaryDto;

  @ApiPropertyOptional({
    type: () => SpaceDashboardReservationSummaryDto,
    description: '卡片当前主预约摘要（今日未到或超时未处理）',
  })
  @ValidateNested()
  @Type(() => SpaceDashboardReservationSummaryDto)
  activeReservationSummary?: SpaceDashboardReservationSummaryDto;

  @ApiPropertyOptional({
    type: () => SpaceDashboardReservationSummaryDto,
    description: '未来日期预约摘要',
  })
  @ValidateNested()
  @Type(() => SpaceDashboardReservationSummaryDto)
  futureReservationSummary?: SpaceDashboardReservationSummaryDto;
}

export class SpaceStatsResponseDto {
  @ApiProperty({ example: 8, description: '空间总数' })
  total: number;

  @ApiProperty({ example: 3, description: '空闲空间数' })
  idle: number;

  @ApiProperty({ example: 2, description: '使用中空间数' })
  occupied: number;

  @ApiProperty({ example: 2, description: '已预约空间数' })
  reserved: number;

  @ApiProperty({ example: 1, description: '脏房空间数' })
  cleaning: number;

  @ApiProperty({ example: 0, description: '今日结账次数' })
  todaySettled: number;

  @ApiProperty({ example: 0, description: '今日营业额' })
  todayRevenue: number;
}

export class SpaceDashboardFilterOptionsDto {
  @ApiProperty({ example: ['包间', '餐桌'], description: '空间类型筛选项' })
  types: string[];

  @ApiProperty({ example: ['1楼', '2楼'], description: '空间区域筛选项' })
  zones: string[];

  @ApiProperty({ example: true, description: '是否展示脏房 Tab' })
  showDirtyTab: boolean;
}

export class SpacesDashboardResponseDto {
  @ApiProperty({ type: SpaceStatsResponseDto, description: '空间统计汇总' })
  @ValidateNested()
  @Type(() => SpaceStatsResponseDto)
  stats: SpaceStatsResponseDto;

  @ApiProperty({
    type: SpaceDashboardFilterOptionsDto,
    description: '筛选项数据',
  })
  @ValidateNested()
  @Type(() => SpaceDashboardFilterOptionsDto)
  filterOptions: SpaceDashboardFilterOptionsDto;

  @ApiProperty({
    type: [SpaceDashboardSpaceItemDto],
    description: '空间卡片列表',
  })
  spaces: SpaceDashboardSpaceItemDto[];
}
