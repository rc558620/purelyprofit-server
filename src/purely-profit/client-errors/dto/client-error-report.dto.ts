import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

export const CLIENT_ERROR_SOURCE_VALUES = [
  'http',
  'window-error',
  'unhandledrejection',
  'react-render',
] as const;

export type ClientErrorSource = (typeof CLIENT_ERROR_SOURCE_VALUES)[number];

export class ClientErrorAppDto {
  @ApiProperty({ example: 'production', description: '前端运行模式' })
  @IsString({ message: 'app.mode 必须是字符串' })
  mode: string;

  @ApiPropertyOptional({ example: '1.0.0', description: '前端发布版本号' })
  @IsOptional()
  @IsString({ message: 'app.release 必须是字符串' })
  release?: string;

  @ApiProperty({
    example: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4)',
    description: '浏览器 userAgent',
  })
  @IsString({ message: 'app.userAgent 必须是字符串' })
  userAgent: string;

  @ApiPropertyOptional({ example: 'zh-CN', description: '浏览器语言' })
  @IsOptional()
  @IsString({ message: 'app.language 必须是字符串' })
  language?: string;

  @ApiProperty({
    example: 'https://profit.example.com/main/dashboard?tab=today',
    description: '错误发生时的完整页面地址',
  })
  @IsString({ message: 'app.url 必须是字符串' })
  url: string;

  @ApiProperty({ example: '/main/dashboard', description: '页面 pathname' })
  @IsString({ message: 'app.pathname 必须是字符串' })
  pathname: string;

  @ApiProperty({ example: '?tab=today', description: '页面 search' })
  @IsString({ message: 'app.search 必须是字符串' })
  search: string;

  @ApiProperty({ example: '#profit', description: '页面 hash' })
  @IsString({ message: 'app.hash 必须是字符串' })
  hash: string;
}

export class ClientErrorUserDto {
  @ApiPropertyOptional({ example: 'Forest', description: '当前用户名称' })
  @IsOptional()
  @IsString({ message: 'user.name 必须是字符串' })
  name?: string;

  @ApiPropertyOptional({ example: '13800001111', description: '当前用户手机号' })
  @IsOptional()
  @IsString({ message: 'user.phone 必须是字符串' })
  phone?: string;

  @ApiProperty({ example: true, description: '当前用户是否已实名认证' })
  @IsBoolean({ message: 'user.verified 必须是布尔值' })
  verified: boolean;
}

export class ClientErrorStoreDto {
  @ApiPropertyOptional({ example: 18, description: '当前门店 ID' })
  @IsOptional()
  @IsInt({ message: 'store.id 必须是整数' })
  id?: number;

  @ApiPropertyOptional({ example: '纯利咖啡', description: '当前门店名称' })
  @IsOptional()
  @IsString({ message: 'store.storeName 必须是字符串' })
  storeName?: string;

  @ApiPropertyOptional({ example: 'tea', description: '当前门店业态' })
  @IsOptional()
  @IsString({ message: 'store.storeType 必须是字符串' })
  storeType?: string;
}

export class ClientErrorReportDto {
  @ApiProperty({
    example: 'err_1234567890_abcd1234',
    description: '前端生成的错误上报唯一 ID',
  })
  @IsString({ message: 'reportId 必须是字符串' })
  reportId: string;

  @ApiProperty({
    enum: CLIENT_ERROR_SOURCE_VALUES,
    description: '错误来源类型',
  })
  @IsIn(CLIENT_ERROR_SOURCE_VALUES, { message: 'source 不合法' })
  source: ClientErrorSource;

  @ApiProperty({ example: 'Request failed with status code 500', description: '错误消息' })
  @IsString({ message: 'message 必须是字符串' })
  message: string;

  @ApiProperty({ example: 'ApiError', description: '错误名称' })
  @IsString({ message: 'errorName 必须是字符串' })
  errorName: string;

  @ApiPropertyOptional({ description: '前端捕获到的错误堆栈' })
  @IsOptional()
  @IsString({ message: 'stack 必须是字符串' })
  stack?: string;

  @ApiPropertyOptional({ example: 500, description: 'HTTP 状态码' })
  @IsOptional()
  @IsInt({ message: 'statusCode 必须是整数' })
  statusCode?: number;

  @ApiPropertyOptional({
    description: '业务错误码，允许字符串或数字',
    oneOf: [{ type: 'string' }, { type: 'number' }],
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (typeof value === 'number') {
      return String(value);
    }

    return value;
  })
  @IsString({ message: 'businessCode 必须是字符串或数字' })
  businessCode?: string;

  @ApiProperty({
    example: '2026-06-08T11:20:00.000Z',
    description: '前端记录的错误发生时间',
  })
  @IsDateString({}, { message: 'occurredAt 必须是合法的 ISO 时间字符串' })
  occurredAt: string;

  @ApiProperty({ type: ClientErrorAppDto, description: '前端应用上下文' })
  @ValidateNested()
  @Type(() => ClientErrorAppDto)
  app: ClientErrorAppDto;

  @ApiPropertyOptional({ type: ClientErrorUserDto, description: '当前用户上下文' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientErrorUserDto)
  user?: ClientErrorUserDto;

  @ApiPropertyOptional({ type: ClientErrorStoreDto, description: '当前门店上下文' })
  @IsOptional()
  @ValidateNested()
  @Type(() => ClientErrorStoreDto)
  store?: ClientErrorStoreDto;

  @ApiPropertyOptional({
    description: '额外错误细节，保留前端透传字段',
    additionalProperties: true,
  })
  @IsOptional()
  @IsObject({ message: 'details 必须是对象' })
  details?: Record<string, unknown>;
}
