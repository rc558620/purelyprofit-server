import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeShiftType, HandoverMode, HandoverStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';
import {
  HandoverModeDto,
  HandoverOrderItemDto,
  HandoverPaymentItemDto,
  HandoverRecordDisplayStatusDto,
  HandoverRecordsPresetDto,
  HandoverRevenueSummaryDto,
  HandoverStatusDto,
} from './handover-shared.dto';

export class CreateHandoverRecordDto {
  @ApiPropertyOptional({
    description:
      '交班模式: self_main_account(主账号自交班) / sub_account(子账号交班)',
    enum: HandoverModeDto,
    example: HandoverModeDto.SUB_ACCOUNT,
  })
  @IsOptional()
  @IsEnum(HandoverModeDto)
  handoverMode?: HandoverModeDto;

  @ApiPropertyOptional({
    description: '接收员工ID，子账号交班时必填',
    example: 123,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '接收员工 ID 必须是整数' })
  toEmployeeId?: number;

  @ApiPropertyOptional({
    description: '交班备注',
    example: '今日营业额 5000 元，现金 2000 元',
  })
  @IsOptional()
  @IsString({ message: '交班备注必须是字符串' })
  @MaxLength(500, { message: '交班备注不能超过 500 个字符' })
  note?: string;
}

export class CompleteHandoverRecordDto {
  @ApiPropertyOptional({
    description: '交班备注',
    example: '确认无误，已接收',
  })
  @IsOptional()
  @IsString({ message: '交班备注必须是字符串' })
  @MaxLength(500, { message: '交班备注不能超过 500 个字符' })
  note?: string;
}

export class CancelHandoverRecordDto {
  @ApiProperty({
    description: '取消原因',
    example: '临时有事，取消交班',
  })
  @IsString({ message: '取消原因必须是字符串' })
  @MaxLength(200, { message: '取消原因不能超过 200 个字符' })
  reason: string;
}

export class HandoverRecordShiftInfoDto {
  @ApiProperty({ example: '收银员1', description: '交班班次的操作员工' })
  operatorName: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: '交班人头像地址，未设置时不返回',
  })
  @IsOptional()
  @IsString({ message: '交班人头像必须是字符串' })
  operatorAvatar?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: '交班人头像地址（兼容前端 avatar 字段）',
  })
  @IsOptional()
  @IsString({ message: '交班人头像必须是字符串' })
  avatar?: string;

  @ApiPropertyOptional({
    description: '班次类型，存在排班记录时返回',
    enum: EmployeeShiftType,
    example: EmployeeShiftType.morning,
  })
  shiftType?: EmployeeShiftType | null;

  @ApiProperty({ example: '早班', description: '班次标签' })
  shiftLabel: string;

  @ApiPropertyOptional({ example: '09:00', description: '班次开始时间' })
  startTime?: string | null;

  @ApiPropertyOptional({ example: '17:00', description: '班次结束时间' })
  endTime?: string | null;

  @ApiProperty({ example: '06-02  09:00–17:00', description: '班次时间描述' })
  timeDesc: string;
}

export class HandoverRecordDetailAdditionalItemDto {
  @ApiProperty({ example: 1, description: '附加项记录 ID' })
  id: number;

  @ApiProperty({ example: 101, description: '附加项定义 ID' })
  itemId: number;

  @ApiProperty({ example: '房卡', description: '附加项名称' })
  itemName: string;

  @ApiProperty({ example: '2 张', description: '附加项填写值' })
  value: string;

  @ApiProperty({ example: 1748766600000, description: '创建时间戳(ms)' })
  createdAt: number;

  @ApiProperty({ example: 1748767200000, description: '更新时间戳(ms)' })
  updatedAt: number;
}

export class HandoverRecordListItemDto {
  @ApiProperty({ example: 1, description: '记录ID' })
  id: number;

  @ApiProperty({
    enum: HandoverMode,
    description: '交班模式',
  })
  handoverMode: HandoverModeDto;

  @ApiProperty({
    enum: HandoverStatus,
    description: '交班状态',
  })
  status: HandoverStatusDto;

  @ApiPropertyOptional({ example: 123, description: '发起员工ID' })
  fromEmployeeId?: number | null;

  @ApiPropertyOptional({ example: '张三', description: '发起员工姓名' })
  fromEmployeeName?: string | null;

  @ApiPropertyOptional({ example: 456, description: '接收员工ID' })
  toEmployeeId?: number | null;

  @ApiPropertyOptional({ example: '李四', description: '接收员工姓名' })
  toEmployeeName?: string | null;

  @ApiPropertyOptional({
    example: '今日营业额 5000 元',
    description: '交班备注',
  })
  note?: string | null;

  @ApiPropertyOptional({ example: '临时取消', description: '取消原因' })
  reason?: string | null;

  @ApiPropertyOptional({
    example: 1747212600000,
    description: '交班时间戳(ms)',
  })
  handoverAt?: number | null;

  @ApiProperty({ example: 1747184400000, description: '创建时间戳(ms)' })
  createdAt: number;

  @ApiProperty({ example: 1747184400000, description: '更新时间戳(ms)' })
  updatedAt: number;

  @ApiPropertyOptional({
    type: HandoverRecordShiftInfoDto,
    description: '交班记录对应的班次信息',
  })
  shiftInfo?: HandoverRecordShiftInfoDto | null;

  @ApiProperty({
    type: [HandoverRecordDetailAdditionalItemDto],
    description: '交班附加项填写结果',
  })
  additionalItems: HandoverRecordDetailAdditionalItemDto[];

  @ApiPropertyOptional({
    type: HandoverRevenueSummaryDto,
    description: '交班详情页收入概况',
  })
  revenueSummary?: HandoverRevenueSummaryDto;

  @ApiPropertyOptional({
    type: [HandoverPaymentItemDto],
    description: '交班详情页收款方式明细',
  })
  paymentItems?: HandoverPaymentItemDto[];

  @ApiPropertyOptional({
    type: [HandoverOrderItemDto],
    description: '交班详情页订单明细',
  })
  orderItems?: HandoverOrderItemDto[];

  @ApiPropertyOptional({
    example: '李四',
    description: '交班详情页展示的接班人姓名',
  })
  receiverName?: string;
}

export class HandoverCandidateDto {
  @ApiProperty({ example: 123, description: '员工ID' })
  employeeId: number;

  @ApiProperty({ example: '张三', description: '员工姓名' })
  employeeName: string;

  @ApiProperty({ example: 1, description: '子账号槽位索引' })
  slotIndex: number;

  @ApiProperty({
    example: 'cashier',
    enum: ['cashier', 'finance', 'manager'],
    description: '子账号角色',
  })
  role: string;
}

export class HandoverRecordListResponseDto {
  @ApiProperty({
    type: [HandoverRecordListItemDto],
    description: '交班记录列表',
  })
  items: HandoverRecordListItemDto[];

  @ApiProperty({ example: 10, description: '总数' })
  total: number;
}

export class HandoverRecordSummaryQueryDto {
  @ApiPropertyOptional({
    description: '筛选范围：today/7d/30d，默认 today',
    enum: HandoverRecordsPresetDto,
    example: HandoverRecordsPresetDto.TODAY,
  })
  @IsOptional()
  @IsEnum(HandoverRecordsPresetDto, { message: '筛选范围不正确' })
  preset?: HandoverRecordsPresetDto;

  @ApiPropertyOptional({
    description: '指定日期，格式 YYYY-MM-DD；传入后优先按该日期过滤',
    example: '2026-06-02',
  })
  @IsOptional()
  @IsString({ message: '日期必须是字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: '日期格式必须为 YYYY-MM-DD',
  })
  date?: string;

  @ApiPropertyOptional({
    description: '分页大小，默认 20，最大 100',
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '分页大小必须是整数' })
  @Min(1, { message: '分页大小不能小于 1' })
  limit?: number;

  @ApiPropertyOptional({
    description: '分页偏移，默认 0',
    example: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '分页偏移必须是整数' })
  @Min(0, { message: '分页偏移不能小于 0' })
  offset?: number;
}

export class HandoverRecordSummaryDto {
  @ApiProperty({ example: 1, description: '交班记录 ID' })
  id: number;

  @ApiProperty({ example: '房东莎莎', description: '交班人姓名' })
  operatorName: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: '交班人头像地址，未设置时不返回',
  })
  @IsOptional()
  @IsString({ message: '交班人头像必须是字符串' })
  operatorAvatar?: string;

  @ApiPropertyOptional({
    example: 'https://example.com/avatar.jpg',
    description: '交班人头像地址（兼容前端 avatar 字段）',
  })
  @IsOptional()
  @IsString({ message: '交班人头像必须是字符串' })
  avatar?: string;

  @ApiPropertyOptional({
    description: '班次类型，存在排班记录时返回',
    enum: EmployeeShiftType,
    example: EmployeeShiftType.morning,
  })
  shiftType?: EmployeeShiftType | null;

  @ApiProperty({ example: '早班', description: '班次标签' })
  shiftLabel: string;

  @ApiPropertyOptional({ example: '09:00', description: '班次开始时间' })
  startTime?: string | null;

  @ApiPropertyOptional({ example: '17:00', description: '班次结束时间' })
  endTime?: string | null;

  @ApiProperty({ example: '06-02  09:00–17:00', description: '班次时间描述' })
  timeDesc: string;

  @ApiProperty({ example: 1004.65, description: '本班次营业额' })
  totalRevenue: number;

  @ApiProperty({
    enum: HandoverStatus,
    description: '后端真实交班状态',
  })
  status: HandoverStatusDto;

  @ApiProperty({
    enum: HandoverRecordDisplayStatusDto,
    description: '弹窗展示状态',
    example: HandoverRecordDisplayStatusDto.DONE,
  })
  displayStatus: HandoverRecordDisplayStatusDto;

  @ApiPropertyOptional({
    example: 1748766600000,
    description: '交班时间戳(ms)',
  })
  handoverAt?: number | null;

  @ApiProperty({ example: 1748766600000, description: '创建时间戳(ms)' })
  createdAt: number;
}

export class HandoverRecordSummaryListResponseDto {
  @ApiProperty({
    type: [HandoverRecordSummaryDto],
    description: '交班记录弹窗列表',
  })
  items: HandoverRecordSummaryDto[];

  @ApiProperty({ example: 10, description: '总数' })
  total: number;
}
