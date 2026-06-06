import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { EmployeeShiftType } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import {
  HandoverOrderItemDto,
  HandoverPaymentItemDto,
  HandoverRevenueSummaryDto,
} from './handover-shared.dto';

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

  @ApiProperty({ example: '晚晚班', description: '班次名称' })
  shiftName: string;

  @ApiProperty({ example: '晚晚班', description: '班次展示标签' })
  shiftLabel: string;

  @ApiProperty({ example: '08:00', description: '上班时间' })
  startTime: string;

  @ApiProperty({ example: '14:00', description: '下班时间' })
  endTime: string;

  @ApiProperty({ example: '张三', description: '交班人姓名' })
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

  @ApiProperty({
    example: 1748766600000,
    description: '班次归属时间戳(ms)，用于判定班次日期',
  })
  shiftReferenceAt: number;
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

  @ApiProperty({
    example: true,
    description: '当前用户是否可对该班次执行交班相关操作',
  })
  canOperate: boolean;

  @ApiPropertyOptional({
    example: '当前班次不属于该收银员，暂不允许操作',
    description: '不可操作原因，canOperate=false 时返回',
  })
  operationBlockedReason?: string | null;

  @ApiProperty({
    example: false,
    description:
      '当前账号今日最近班次已完成交班，且从该班次之后暂无后续排班时为 true，用于前端优化空态文案',
  })
  handoverCompletedAndNoUpcomingShift: boolean;
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

  @ApiPropertyOptional({
    example: 1748764800000,
    description: '页面返回的班次参考时间戳(ms)，用于精确锁定自定义班次',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '班次参考时间必须是整数时间戳' })
  shiftReferenceAt?: number;

  @ApiPropertyOptional({
    example: '张三',
    description: '页面展示的交班人姓名，用于多员工同班次时精确定位',
  })
  @IsOptional()
  @IsString({ message: '交班人姓名必须是字符串' })
  @MaxLength(50, { message: '交班人姓名不能超过 50 个字符' })
  operatorName?: string;

  @ApiProperty({
    example: 1748766600000,
    description: '实际确认交班时间戳(ms)',
  })
  @Type(() => Number)
  @IsInt({ message: '交班时间必须是整数时间戳' })
  confirmedAt: number;

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
