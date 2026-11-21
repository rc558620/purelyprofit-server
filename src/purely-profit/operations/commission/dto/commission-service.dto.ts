import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
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

/** 服务人员提成覆盖项（元）。 */
export class CommissionOverrideDto {
  @ApiProperty({ example: 1, description: '服务人员 ID' })
  @Type(() => Number)
  @IsInt({ message: '服务人员 ID 必须是整数' })
  @Min(1, { message: '服务人员 ID 必须大于等于 1' })
  technicianId: number;

  @ApiProperty({ example: 60, description: '该服务人员在此服务下的提成（元）' })
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '提成金额最多保留两位小数' })
  @Min(0, { message: '提成金额不能为负数' })
  @Max(COMMISSION_AMOUNT_MAX, { message: '提成金额不能超过 100000 元' })
  commission: number;
}

/** 服务名统一在入库前去掉首尾空格，纯空格会因长度不足被拒绝。 */
const trimServiceName = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? value.trim() : value;

/** 创建提成服务配置。 */
export class CreateCommissionServiceDto {
  @ApiProperty({ example: '足疗', description: '服务名（1-20 字符）' })
  @Transform(trimServiceName)
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

  @ApiPropertyOptional({ example: true, description: '是否启用，默认启用' })
  @IsOptional()
  @IsBoolean({ message: '启用标记必须是布尔值' })
  enabled?: boolean;

  @ApiPropertyOptional({
    example: 1,
    description: '排序值，越小越靠前，默认 1',
  })
  @IsOptional()
  @IsInt({ message: '排序值必须是整数' })
  @Min(1, { message: '排序值必须大于等于 1' })
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [CommissionOverrideDto],
    description: '服务人员提成覆盖表，创建时可直接指定',
  })
  @IsOptional()
  @IsArray({ message: '覆盖表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CommissionOverrideDto)
  overrides?: CommissionOverrideDto[];
}

/**
 * 更新提成服务配置。
 * 只有显式传入的字段会被更新，未传字段保持原值；`overrides` 未传时不清空覆盖表。
 */
export class UpdateCommissionServiceDto {
  @ApiPropertyOptional({ example: '足疗', description: '服务名（1-20 字符）' })
  @IsOptional()
  @Transform(trimServiceName)
  @IsString({ message: '服务名必须是字符串' })
  @Length(1, COMMISSION_SERVICE_NAME_MAX_LENGTH, {
    message: '服务名长度必须为 1-20 个字符',
  })
  name?: string;

  @ApiPropertyOptional({ example: 60, description: '默认提成（元，0-100000）' })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 }, { message: '默认提成最多保留两位小数' })
  @Min(0, { message: '默认提成不能为负数' })
  @Max(COMMISSION_AMOUNT_MAX, { message: '默认提成不能超过 100000 元' })
  defaultCommission?: number;

  @ApiPropertyOptional({ example: true, description: '是否启用' })
  @IsOptional()
  @IsBoolean({ message: '启用标记必须是布尔值' })
  enabled?: boolean;

  @ApiPropertyOptional({ example: 1, description: '排序值，越小越靠前' })
  @IsOptional()
  @IsInt({ message: '排序值必须是整数' })
  @Min(1, { message: '排序值必须大于等于 1' })
  sortOrder?: number;

  @ApiPropertyOptional({
    type: [CommissionOverrideDto],
    description: '服务人员提成覆盖表（传入才替换，未传保持原值）',
  })
  @IsOptional()
  @IsArray({ message: '覆盖表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CommissionOverrideDto)
  overrides?: CommissionOverrideDto[];

  @ApiPropertyOptional({
    example: 1741410000000,
    description: '编辑前的更新时间戳（毫秒），用于检测并发的旧版本提交',
  })
  @IsOptional()
  @IsInt({ message: '更新时间戳必须是整数' })
  @Min(1, { message: '更新时间戳必须大于等于 1' })
  expectedUpdatedAt?: number;
}

/** 开台服务项选项：只暴露选择所需字段，不含提成金额与覆盖表。 */
export class CommissionOpenOptionServiceDto {
  @ApiProperty({ example: 1, description: '服务项 ID' })
  id: number;

  @ApiProperty({ example: '足疗', description: '服务名' })
  name: string;
}

/** 开台服务人员选项：只暴露选择所需字段，不含手机号、薪资等员工档案信息。 */
export class CommissionOpenOptionTechnicianDto {
  @ApiProperty({ example: 12, description: '员工 ID' })
  id: number;

  @ApiProperty({ example: '张先生', description: '员工姓名' })
  name: string;

  @ApiProperty({ example: '技师', description: '员工职位' })
  position: string;
}

/** 开台选项响应：已启用服务项 + 在职服务人员。 */
export class CommissionOpenOptionsResponseDto {
  @ApiProperty({
    type: [CommissionOpenOptionServiceDto],
    description: '已启用的服务项（无可用配置时为空数组）',
  })
  services: CommissionOpenOptionServiceDto[];

  @ApiProperty({
    type: [CommissionOpenOptionTechnicianDto],
    description: '在职服务人员（按门店服务人员称呼口径过滤）',
  })
  technicians: CommissionOpenOptionTechnicianDto[];
}

/** 服务人员覆盖项响应（金额为元）。 */
export class CommissionOverrideResponseDto {
  @ApiProperty({ example: 1, description: '服务人员 ID' })
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
