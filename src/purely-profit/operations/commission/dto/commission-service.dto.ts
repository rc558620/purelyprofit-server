import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  COMMISSION_AMOUNT_MAX,
  COMMISSION_SERVICE_NAME_MAX_LENGTH,
} from '../commission.constants';

/** 技师提成覆盖项（元）。 */
export class CommissionOverrideDto {
  @ApiProperty({ example: 1, description: '技师员工 ID' })
  @Type(() => Number)
  @IsInt({ message: '技师员工 ID 必须是整数' })
  @Min(1, { message: '技师员工 ID 必须大于等于 1' })
  technicianId: number;

  @ApiProperty({ example: 60, description: '该技师在此服务下的提成（元）' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '提成金额最多保留两位小数' })
  @Min(0, { message: '提成金额不能为负数' })
  @Max(COMMISSION_AMOUNT_MAX, { message: '提成金额不能超过 100000 元' })
  commission: number;
}

/** 创建/更新提成服务配置（前端 PATCH 为全量替换，字段与创建一致）。 */
export class UpsertCommissionServiceDto {
  @ApiProperty({ example: '足疗', description: '服务名（1-20 字符）' })
  @IsString({ message: '服务名必须是字符串' })
  @Length(1, COMMISSION_SERVICE_NAME_MAX_LENGTH, {
    message: '服务名长度必须为 1-20 个字符',
  })
  name: string;

  @ApiProperty({ example: 60, description: '默认提成（元，0-100000）' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '默认提成最多保留两位小数' })
  @Min(0, { message: '默认提成不能为负数' })
  @Max(COMMISSION_AMOUNT_MAX, { message: '默认提成不能超过 100000 元' })
  defaultCommission: number;

  @ApiProperty({ example: true, description: '是否启用' })
  @IsBoolean({ message: '启用标记必须是布尔值' })
  enabled: boolean;

  @ApiProperty({ example: 1, description: '排序值，越小越靠前' })
  @IsInt({ message: '排序值必须是整数' })
  @Min(1, { message: '排序值必须大于等于 1' })
  sortOrder: number;

  @ApiPropertyOptional({
    type: [CommissionOverrideDto],
    description: '技师提成覆盖表（全量替换）',
  })
  @IsOptional()
  @IsArray({ message: '覆盖表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CommissionOverrideDto)
  overrides?: CommissionOverrideDto[];
}

/** 技师覆盖项响应（金额为元）。 */
export class CommissionOverrideResponseDto {
  @ApiProperty({ example: 1, description: '技师员工 ID' })
  technicianId: number;

  @ApiProperty({ example: 60, description: '提成（元）' })
  commission: number;
}

/** 提成服务配置响应（金额为元）。 */
export class CommissionServiceResponseDto {
  @ApiProperty({ example: 1, description: '服务项 ID' })
  id: number;

  @ApiProperty({ example: '足疗', description: '服务名' })
  name: string;

  @ApiProperty({ example: 60, description: '默认提成（元）' })
  defaultCommission: number;

  @ApiProperty({ example: true, description: '是否启用' })
  enabled: boolean;

  @ApiProperty({ example: 1, description: '排序值' })
  sortOrder: number;

  @ApiProperty({ type: [CommissionOverrideResponseDto], description: '覆盖表' })
  overrides: CommissionOverrideResponseDto[];

  @ApiProperty({ example: 1741323600000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiProperty({ example: 1741410000000, description: '更新时间戳（毫秒）' })
  updatedAt: number;
}
