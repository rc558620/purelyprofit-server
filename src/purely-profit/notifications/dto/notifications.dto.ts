import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  PaginationMetaDto,
  PaginationQueryDto,
  transformOptionalBoolean,
  transformOptionalInt,
} from '../../stores/dto/store-response.dto';
import {
  NOTIFICATION_TYPE_VALUES,
  type NotificationTypeValue,
} from '../notifications.types';

export class NotificationsStoreQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;
}

export class ListNotificationsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID，不传默认当前门店' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    enum: NOTIFICATION_TYPE_VALUES,
    description: '通知类型筛选',
  })
  @IsOptional()
  @IsIn(NOTIFICATION_TYPE_VALUES, { message: '通知类型不合法' })
  type?: NotificationTypeValue;

  @ApiPropertyOptional({ example: true, description: '是否只看未读通知' })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'unreadOnly 必须是布尔值' })
  unreadOnly?: boolean;
}

// ─── Response DTOs（仅 Swagger 注解，不加 class-validator 校验） ────────────────

export class NotificationItemDto {
  @ApiProperty({ example: 'inventory:product:5', description: '通知 ID' })
  id: string;

  @ApiProperty({
    enum: NOTIFICATION_TYPE_VALUES,
    description: '通知类型',
  })
  type: NotificationTypeValue;

  @ApiProperty({ example: '可乐 库存不足', description: '通知标题' })
  title: string;

  @ApiProperty({
    example: '当前库存 4，已低于预警阈值 10，请及时补货。',
    description: '通知内容',
  })
  content: string;

  @ApiPropertyOptional({ example: 'inventory', description: '业务类型' })
  bizType?: string;

  @ApiPropertyOptional({ example: '5', description: '业务对象 ID' })
  bizId?: string;

  @ApiPropertyOptional({
    example: '/stocktaking',
    description: '前端跳转地址',
  })
  actionUrl?: string;

  @ApiProperty({
    example: 1747212600000,
    description: '通知创建时间戳（毫秒）',
  })
  createdAt: number;

  @ApiPropertyOptional({
    example: 1747216200000,
    description: '已读时间戳（毫秒），未读时不返回',
  })
  readAt?: number;
}

export class NotificationSummaryItemDto {
  @ApiProperty({ example: 'inventory:product:5', description: '通知 ID' })
  id: string;

  @ApiProperty({
    enum: NOTIFICATION_TYPE_VALUES,
    description: '通知类型',
  })
  type: NotificationTypeValue;

  @ApiProperty({ example: '可乐 库存不足', description: '通知标题' })
  title: string;

  @ApiProperty({
    example: 1747212600000,
    description: '通知创建时间戳（毫秒）',
  })
  createdAt: number;

  @ApiPropertyOptional({
    example: '/stocktaking',
    description: '前端跳转地址',
  })
  actionUrl?: string;
}

export class NotificationsUnreadSummaryResponseDto {
  @ApiProperty({ example: 3, description: '当前未读通知数量' })
  unreadCount: number;

  @ApiProperty({
    type: [NotificationSummaryItemDto],
    description: '最新未读通知摘要',
  })
  @Type(() => NotificationSummaryItemDto)
  latestItems: NotificationSummaryItemDto[];
}

export class NotificationsListResponseDto {
  @ApiProperty({ type: [NotificationItemDto], description: '通知列表' })
  @Type(() => NotificationItemDto)
  items: NotificationItemDto[];

  @ApiProperty({ example: 6, description: '当前未读通知数量' })
  unreadCount: number;

  @ApiProperty({ type: PaginationMetaDto, description: '分页信息' })
  @ValidateNested()
  @Type(() => PaginationMetaDto)
  meta: PaginationMetaDto;
}

export class MarkNotificationReadResponseDto {
  @ApiProperty({ example: true, description: '是否标记成功' })
  success: boolean;

  @ApiProperty({ example: 'inventory:product:5', description: '通知 ID' })
  id: string;

  @ApiProperty({
    example: 1747216200000,
    description: '本次标记已读时间戳（毫秒）',
  })
  readAt: number;

  @ApiProperty({ example: 2, description: '标记后的未读通知数量' })
  unreadCount: number;
}

export class MarkAllNotificationsReadResponseDto {
  @ApiProperty({ example: true, description: '是否全部标记成功' })
  success: boolean;

  @ApiProperty({
    example: 1747216200000,
    description: '全部标记已读时间戳（毫秒）',
  })
  readAt: number;

  @ApiProperty({ example: 0, description: '标记后的未读通知数量' })
  unreadCount: number;
}
