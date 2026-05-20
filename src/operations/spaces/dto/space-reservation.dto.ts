import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  SPACE_RESERVATION_STATUS_VALUES,
  type SpaceReservationStatusValue,
} from '../spaces.constants';

const SPACE_RESERVATION_CONTACT_PATTERN = /^[0-9+\-\s]{6,20}$/;

export class ListSpaceReservationsQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 'pending',
    description: '预约状态筛选，默认 pending',
    enum: SPACE_RESERVATION_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_RESERVATION_STATUS_VALUES, { message: '预约状态不合法' })
  status?: SpaceReservationStatusValue;

  @ApiPropertyOptional({
    example: 1760054400000,
    description: '按预约开始时间过滤：区间起始时间戳（毫秒，含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间起始时间必须是整数时间戳' })
  @Min(0, { message: '区间起始时间不合法' })
  dateFrom?: number;

  @ApiPropertyOptional({
    example: 1760140799999,
    description: '按预约开始时间过滤：区间结束时间戳（毫秒，含）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  dateTo?: number;
}

export class CreateSpaceReservationDto {
  @ApiProperty({ example: '张先生', description: '预约人姓名' })
  @IsString({ message: '预约人姓名必须是字符串' })
  @MinLength(1, { message: '预约人姓名不能为空' })
  @MaxLength(20, { message: '预约人姓名最长 20 个字符' })
  guestName: string;

  @ApiProperty({ example: '13800138000', description: '联系方式' })
  @IsString({ message: '联系方式必须是字符串' })
  @MinLength(1, { message: '联系方式不能为空' })
  @MaxLength(20, { message: '联系方式最长 20 个字符' })
  @Matches(SPACE_RESERVATION_CONTACT_PATTERN, {
    message: '联系方式格式不正确，请输入 6-20 位数字或常见联系电话格式',
  })
  phone: string;

  @ApiProperty({
    example: 1760104800000,
    description: '预约开始时间戳（毫秒）',
  })
  @Transform(transformOptionalInt)
  @IsInt({ message: '预约开始时间必须是整数时间戳' })
  reservedAt: number;

  @ApiProperty({
    example: 1760108400000,
    description: '预约结束时间戳（毫秒）',
  })
  @Transform(transformOptionalInt)
  @IsInt({ message: '预约结束时间必须是整数时间戳' })
  reservedEndAt: number;

  @ApiPropertyOptional({ example: 4, description: '预约人数' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '预约人数必须是整数' })
  @Min(1, { message: '预约人数必须大于等于 1' })
  @Max(999, { message: '预约人数必须小于等于 999' })
  guestCount?: number;

  @ApiPropertyOptional({ example: '生日聚会', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

export class UpdateSpaceReservationDto {
  @ApiProperty({ example: '张先生', description: '预约人姓名' })
  @IsString({ message: '预约人姓名必须是字符串' })
  @MinLength(1, { message: '预约人姓名不能为空' })
  @MaxLength(20, { message: '预约人姓名最长 20 个字符' })
  guestName: string;

  @ApiProperty({ example: '13800138000', description: '联系方式' })
  @IsString({ message: '联系方式必须是字符串' })
  @MinLength(1, { message: '联系方式不能为空' })
  @MaxLength(20, { message: '联系方式最长 20 个字符' })
  @Matches(SPACE_RESERVATION_CONTACT_PATTERN, {
    message: '联系方式格式不正确，请输入 6-20 位数字或常见联系电话格式',
  })
  phone: string;

  @ApiProperty({
    example: 1760104800000,
    description: '预约开始时间戳（毫秒）',
  })
  @Transform(transformOptionalInt)
  @IsInt({ message: '预约开始时间必须是整数时间戳' })
  reservedAt: number;

  @ApiProperty({
    example: 1760108400000,
    description: '预约结束时间戳（毫秒）',
  })
  @Transform(transformOptionalInt)
  @IsInt({ message: '预约结束时间必须是整数时间戳' })
  reservedEndAt: number;

  @ApiPropertyOptional({ example: 4, description: '预约人数' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '预约人数必须是整数' })
  @Min(1, { message: '预约人数必须大于等于 1' })
  @Max(999, { message: '预约人数必须小于等于 999' })
  guestCount?: number;

  @ApiPropertyOptional({ example: '生日聚会', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}

export class SpaceReservationResponseDto {
  @ApiProperty({ example: '1', description: '预约 ID' })
  id: string;

  @ApiProperty({ example: '1', description: '空间 ID' })
  spaceId: string;

  @ApiProperty({ example: '张先生', description: '预约人姓名' })
  guestName: string;

  @ApiProperty({ example: '13800138000', description: '联系方式' })
  phone: string;

  @ApiProperty({
    example: 1760104800000,
    description: '预约开始时间戳（毫秒）',
  })
  reservedAt: number;

  @ApiPropertyOptional({
    example: 1760108400000,
    description: '预约结束时间戳（毫秒）',
  })
  reservedEndAt?: number;

  @ApiPropertyOptional({ example: 4, description: '预约人数' })
  guestCount?: number;

  @ApiPropertyOptional({ example: '生日聚会', description: '备注' })
  note?: string;

  @ApiProperty({
    example: 'pending',
    description: '预约状态',
    enum: SPACE_RESERVATION_STATUS_VALUES,
  })
  status: SpaceReservationStatusValue;

  @ApiProperty({ example: 1760097600000, description: '创建时间戳（毫秒）' })
  createdAt: number;

  @ApiPropertyOptional({
    example: true,
    description: '预约开始时间是否已过（reservedAt <= 当前时间），过时后 UI 展示为"已过时"，不再参与新增预约冲突校验',
  })
  isOverdue?: boolean;
}
