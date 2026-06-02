import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EmployeeShiftType,
  HandoverMode,
  HandoverStatus,
  SalesPaymentMethod,
} from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export const HandoverModeDto = {
  SELF_MAIN_ACCOUNT: 'self_main_account',
  SUB_ACCOUNT: 'sub_account',
} as const;

export type HandoverModeDto =
  (typeof HandoverModeDto)[keyof typeof HandoverModeDto];

export const HandoverStatusDto = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
} as const;

export type HandoverStatusDto =
  (typeof HandoverStatusDto)[keyof typeof HandoverStatusDto];

export const HandoverRecordDisplayStatusDto = {
  DONE: 'done',
  ACTIVE: 'active',
} as const;

export type HandoverRecordDisplayStatusDto =
  (typeof HandoverRecordDisplayStatusDto)[keyof typeof HandoverRecordDisplayStatusDto];

export const HandoverRecordsPresetDto = {
  TODAY: 'today',
  SEVEN_DAYS: '7d',
  THIRTY_DAYS: '30d',
} as const;

export type HandoverRecordsPresetDto =
  (typeof HandoverRecordsPresetDto)[keyof typeof HandoverRecordsPresetDto];

export class HandoverPageQueryDto {
  @ApiPropertyOptional({
    description: '当前交班班次类型',
    enum: EmployeeShiftType,
    example: EmployeeShiftType.morning,
  })
  @IsOptional()
  @IsEnum(EmployeeShiftType)
  shiftType?: EmployeeShiftType;

  @ApiPropertyOptional({
    description: '交班人姓名，当前仅作为展示兜底值',
    example: '张三',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  operatorName?: string;
}

export class HandoverShiftInfoDto {
  @ApiProperty({ enum: EmployeeShiftType, description: '班次类型' })
  shiftType: EmployeeShiftType;

  @ApiProperty({ example: '08:00', description: '上班时间' })
  startTime: string;

  @ApiProperty({ example: '14:00', description: '下班时间' })
  endTime: string;

  @ApiProperty({ example: '张三', description: '交班人姓名' })
  operatorName: string;

  @ApiProperty({ example: 1748766600000, description: '交班时间戳(ms)' })
  handedOverAt: number;
}

export class HandoverRevenueSummaryDto {
  @ApiProperty({ example: 128, description: '附加收入' })
  additionalRevenue: number;

  @ApiProperty({ example: 520, description: '空间收入' })
  spaceRevenue: number;

  @ApiProperty({ example: 1368, description: '总营业额' })
  totalRevenue: number;

  @ApiProperty({ example: 12, description: '订单数' })
  orderCount: number;

  @ApiProperty({ example: 200, description: '备用金' })
  pettyCache: number;
}

export class HandoverPaymentItemDto {
  @ApiProperty({
    description: '支付方式',
    enum: [...Object.values(SalesPaymentMethod), 'groupon_voucher'],
    example: SalesPaymentMethod.wechat,
  })
  method: SalesPaymentMethod | 'groupon_voucher';

  @ApiProperty({ example: '微信', description: '支付方式中文标签' })
  label: string;

  @ApiProperty({ example: 668, description: '收款金额' })
  amount: number;

  @ApiProperty({ example: 0.48, description: '金额占比' })
  ratio: number;

  @ApiProperty({ example: '#22c55e', description: '展示颜色' })
  color: string;
}

export class HandoverOrderItemDto {
  @ApiProperty({ example: '101', description: '订单项 ID' })
  id: string;

  @ApiProperty({ example: '招牌拿铁', description: '商品名称' })
  productName: string;

  @ApiProperty({ example: 2, description: '销量' })
  quantity: number;

  @ApiProperty({ example: 88, description: '金额' })
  totalRevenue: number;

  @ApiProperty({ example: '微信', description: '支付方式标签' })
  paymentLabel: string;

  @ApiProperty({ example: '#22c55e', description: '支付方式颜色' })
  paymentColor: string;

  @ApiProperty({ example: 1748765400000, description: '订单时间戳(ms)' })
  date: number;

  @ApiPropertyOptional({ example: 18, description: '当前库存' })
  currentStock?: number | null;

  @ApiPropertyOptional({ example: '杯', description: '库存单位' })
  stockUnit?: string | null;
}

export class HandoverPageResponseDto {
  @ApiProperty({ type: HandoverShiftInfoDto, description: '班次信息' })
  shiftInfo: HandoverShiftInfoDto;

  @ApiProperty({
    enum: EmployeeShiftType,
    description: '当前选中的班次类型',
  })
  selectedShiftType: EmployeeShiftType;

  @ApiProperty({ type: HandoverRevenueSummaryDto, description: '收入概况' })
  revenueSummary: HandoverRevenueSummaryDto;

  @ApiProperty({ type: [HandoverPaymentItemDto], description: '收款方式明细' })
  paymentItems: HandoverPaymentItemDto[];

  @ApiProperty({ type: [HandoverOrderItemDto], description: '本班次订单明细' })
  orderItems: HandoverOrderItemDto[];

  @ApiProperty({ example: '李四', description: '接班人姓名' })
  receiverName: string;
}

export class ConfirmHandoverAdditionalItemDto {
  @ApiProperty({ example: 1, description: '附加项 ID' })
  @Type(() => Number)
  @IsInt({ message: '附加项 ID 必须是整数' })
  id: number;

  @ApiProperty({ example: '2 张', description: '本次交班填写的值' })
  @IsString({ message: '附加项内容必须是字符串' })
  @MaxLength(200, { message: '附加项内容不能超过 200 个字符' })
  value: string;
}

export class ConfirmHandoverRequestDto {
  @ApiProperty({
    description: '当前交班班次',
    enum: EmployeeShiftType,
    example: EmployeeShiftType.morning,
  })
  @IsEnum(EmployeeShiftType, { message: '班次类型不正确' })
  shiftType: EmployeeShiftType;

  @ApiProperty({ example: 1748766600000, description: '交班时间戳(ms)' })
  @Type(() => Number)
  @IsInt({ message: '交班时间必须是整数时间戳' })
  handedOverAt: number;

  @ApiPropertyOptional({ example: '今日营业正常', description: '交班备注' })
  @IsOptional()
  @IsString({ message: '交班备注必须是字符串' })
  @MaxLength(500, { message: '交班备注不能超过 500 个字符' })
  note?: string;

  @ApiProperty({
    type: [ConfirmHandoverAdditionalItemDto],
    description: '附加项填写结果',
  })
  @IsArray({ message: '附加项列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => ConfirmHandoverAdditionalItemDto)
  additionalItems: ConfirmHandoverAdditionalItemDto[];
}

export class HandoverAdditionalItemDto {
  @ApiProperty({ example: 1, description: '附加项 ID' })
  id: number;

  @ApiProperty({ example: '房卡', description: '附加项名称' })
  name: string;

  @ApiProperty({ example: 1748766600000, description: '创建时间戳(ms)' })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1748767200000,
    description: '更新时间戳(ms)',
  })
  updatedAt?: number;
}

export class HandoverAdditionalItemListResponseDto {
  @ApiProperty({
    type: [HandoverAdditionalItemDto],
    description: '附加项列表',
  })
  items: HandoverAdditionalItemDto[];
}

export class CreateHandoverAdditionalItemDto {
  @ApiProperty({ example: '房卡', description: '附加项名称' })
  @IsString({ message: '附加项名称必须是字符串' })
  @MaxLength(20, { message: '附加项名称不能超过 20 个字符' })
  name: string;
}

export class UpdateHandoverAdditionalItemDto {
  @ApiProperty({ example: '新房卡', description: '附加项名称' })
  @IsString({ message: '附加项名称必须是字符串' })
  @MaxLength(20, { message: '附加项名称不能超过 20 个字符' })
  name: string;
}

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
