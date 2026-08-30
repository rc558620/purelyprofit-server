import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { COMMISSION_AMOUNT_MAX } from '../commission.constants';

/** 开台提成分配（金额为元；commission 缺省时后端按配置解析）。 */
export class CommissionAssignmentDto {
  @ApiProperty({ example: 1, description: '技师员工 ID' })
  @Type(() => Number)
  @IsInt({ message: '技师员工 ID 必须是整数' })
  @Min(1, { message: '技师员工 ID 必须大于等于 1' })
  technicianId: number;

  @ApiPropertyOptional({ example: '王强', description: '技师姓名快照' })
  @IsOptional()
  @IsString({ message: '技师姓名必须是字符串' })
  @MaxLength(20, { message: '技师姓名最长 20 个字符' })
  technicianName?: string;

  @ApiProperty({ example: [1, 2], description: '关联服务 ID 列表' })
  @Type(() => Number)
  @IsArray({ message: '服务列表必须是数组' })
  @IsInt({ each: true, message: '服务 ID 必须是整数' })
  serviceIds: number[];

  @ApiPropertyOptional({
    example: ['足疗', 'SPA'],
    description: '服务名称快照（可缺省，服务端以配置为准）',
  })
  @IsOptional()
  @IsArray({ message: '服务名称列表必须是数组' })
  @IsString({ each: true, message: '服务名称必须是字符串' })
  serviceNames?: string[];

  @ApiPropertyOptional({
    example: 120,
    description: '提成金额（元，缺省时后端按配置解析）',
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '提成金额最多保留两位小数' })
  @Min(0, { message: '提成金额不能为负数' })
  @Max(COMMISSION_AMOUNT_MAX, { message: '提成金额不能超过 100000 元' })
  commission?: number;
}
