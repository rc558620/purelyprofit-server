// 开台识别查询参数：手机号是本接口唯一检索入口，门店口径与持卡列表一致
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import { MEMBER_CARD_IDENTIFY_PHONE_MAX_LENGTH } from '../member-card.constants';

export class IdentifyMemberCardQueryDto {
  @ApiPropertyOptional({
    example: 1,
    description: '门店 ID（不传则按当前可管理门店）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiProperty({
    example: '13800000001',
    description: '顾客手机号（必填，按当前门店精确匹配营销顾客）',
  })
  @IsString({ message: '手机号必须是字符串' })
  @MinLength(1, { message: '手机号不能为空' })
  @MaxLength(MEMBER_CARD_IDENTIFY_PHONE_MAX_LENGTH, {
    message: `手机号最长 ${MEMBER_CARD_IDENTIFY_PHONE_MAX_LENGTH} 个字符`,
  })
  phone: string;
}
