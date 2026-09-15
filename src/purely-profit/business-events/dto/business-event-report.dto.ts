import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';

export const BUSINESS_EVENT_NAME_MAX_LENGTH = 64;
export const BUSINESS_EVENT_ID_MAX_LENGTH = 64;
export const BUSINESS_EVENT_PROPERTY_KEY_MAX_LENGTH = 40;

export class BusinessEventAppDto {
  @ApiProperty({ example: 'production', description: '前端运行模式' })
  @IsString({ message: 'app.mode 必须是字符串' })
  mode: string;

  @ApiPropertyOptional({ example: '1.0.0', description: '前端发布版本号' })
  @IsOptional()
  @IsString({ message: 'app.release 必须是字符串' })
  release?: string;

  @ApiProperty({ example: 'production', description: '前端运行模式' })
  @IsOptional()
  @IsString({ message: 'app.userAgent 必须是字符串' })
  userAgent?: string;
}

export class BusinessEventStoreDto {
  @ApiPropertyOptional({ example: 18, description: '当前门店 ID' })
  @IsOptional()
  @IsInt({ message: 'store.id 必须是整数' })
  id?: number;
}

export class BusinessEventReportDto {
  @ApiProperty({
    example: 'evt_1719500000000_ab12cd',
    description: '前端生成的事件唯一 ID，用于后端去重',
  })
  @IsString({ message: 'eventId 必须是字符串' })
  @MaxLength(BUSINESS_EVENT_ID_MAX_LENGTH, {
    message: `eventId 长度不能超过 ${BUSINESS_EVENT_ID_MAX_LENGTH}`,
  })
  eventId: string;

  @ApiProperty({
    example: 'membership_quota_blocked',
    description: '事件名（后端按名分流统计）',
  })
  @IsString({ message: 'name 必须是字符串' })
  @MaxLength(BUSINESS_EVENT_NAME_MAX_LENGTH, {
    message: `name 长度不能超过 ${BUSINESS_EVENT_NAME_MAX_LENGTH}`,
  })
  name: string;

  @ApiProperty({
    example: '2026-09-14T09:30:00.000Z',
    description: '事件发生时间（ISO 字符串）',
  })
  @IsISO8601({}, { message: 'occurredAt 必须是合法的 ISO 时间字符串' })
  occurredAt: string;

  @ApiProperty({ example: '/home', description: '事件发生页面 pathname' })
  @IsString({ message: 'pathname 必须是字符串' })
  pathname: string;

  @ApiPropertyOptional({
    example: 'free',
    description: '当前生效会员档位，用于按档位切分漏斗',
  })
  @IsOptional()
  @IsString({ message: 'planTier 必须是字符串' })
  planTier?: string;

  @ApiPropertyOptional({
    description:
      '事件属性。窄口径设计：只允许扁平的原始类型值，避免上报任意嵌套结构',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject({ message: 'properties 必须是对象' })
  properties?: Record<string, unknown>;

  @ApiPropertyOptional({ type: BusinessEventAppDto, description: '前端应用上下文' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessEventAppDto)
  app?: BusinessEventAppDto;

  @ApiPropertyOptional({ type: BusinessEventStoreDto, description: '当前门店上下文' })
  @IsOptional()
  @ValidateNested()
  @Type(() => BusinessEventStoreDto)
  store?: BusinessEventStoreDto;
}
