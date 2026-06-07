import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import {
  PaginationQueryDto,
  transformOptionalInt,
  transformOptionalKeyword,
} from '../../../stores/dto/store-response.dto';
import {
  SPACE_SESSION_STATUS_VALUES,
  type SpaceSessionStatusValue,
} from '../spaces.constants';
import { transformOptionalBoolean } from './space-session.constants';

export class ListSpaceSessionsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, description: '门店 ID' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '门店 ID 必须是整数' })
  @Min(1, { message: '门店 ID 必须大于等于 1' })
  storeId?: number;

  @ApiPropertyOptional({
    example: 'settled',
    description: '按会话状态筛选',
    enum: SPACE_SESSION_STATUS_VALUES,
  })
  @IsOptional()
  @IsIn(SPACE_SESSION_STATUS_VALUES, { message: '会话状态不合法' })
  status?: SpaceSessionStatusValue;

  @ApiPropertyOptional({
    example: false,
    description:
      '未指定 status 时，是否包含 active 会话。多数历史列表接口默认 false 仅返回 settled；根路径 /api/space-sessions 与 /api/space-sessions/active 默认直接按 active 查询。',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'includeActive 必须是布尔值' })
  includeActive?: boolean;

  @ApiPropertyOptional({
    example: '张先生',
    description: '按顾客姓名或手机号搜索',
  })
  @IsOptional()
  @Transform(transformOptionalKeyword)
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;

  @ApiPropertyOptional({
    example: 1715600000000,
    description: '区间开始时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间开始时间必须是整数时间戳' })
  @Min(0, { message: '区间开始时间不合法' })
  rangeStartDate?: number;

  @ApiPropertyOptional({
    example: 1715686399999,
    description: '区间结束时间戳（毫秒）',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '区间结束时间必须是整数时间戳' })
  @Min(0, { message: '区间结束时间不合法' })
  rangeEndDate?: number;
}
