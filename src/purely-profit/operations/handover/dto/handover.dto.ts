import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  IsEnum,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';

export enum HandoverModeDto {
  SELF_MAIN_ACCOUNT = 'self_main_account',
  SUB_ACCOUNT = 'sub_account',
}

export enum HandoverStatusDto {
  PENDING = 'pending',
  COMPLETED = 'completed',
  CANCELLED = 'cancelled',
}

export class CreateHandoverRecordDto {
  @ApiPropertyOptional({
    description:
      '交班模式: self_main_account(主账号自交班) / sub_account(子账号交班)',
    enum: HandoverModeDto,
    example: 'sub_account',
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
  @IsInt()
  toEmployeeId?: number;

  @ApiPropertyOptional({
    description: '交班备注',
    example: '今日营业额 5000 元，现金 2000 元',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CompleteHandoverRecordDto {
  @ApiPropertyOptional({
    description: '交班备注',
    example: '确认无误，已接收',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;
}

export class CancelHandoverRecordDto {
  @ApiProperty({
    description: '取消原因',
    example: '临时有事，取消交班',
  })
  @IsString()
  @MaxLength(200)
  reason: string;
}

export class HandoverRecordListItemDto {
  @ApiProperty({ example: 1, description: '记录ID' })
  id: number;

  @ApiProperty({
    enum: HandoverModeDto,
    description: '交班模式',
  })
  handoverMode: HandoverModeDto;

  @ApiProperty({
    enum: HandoverStatusDto,
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
    enum: ['cashier', 'finance'],
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
