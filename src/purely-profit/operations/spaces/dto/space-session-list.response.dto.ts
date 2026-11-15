import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';
import { SpaceSessionResponseDto } from './space-session-shared.response.dto';

export class PaginatedSpaceSessionsResponseDto {
  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    isArray: true,
    description: '会话列表',
  })
  @IsArray({ message: '会话列表必须是数组' })
  items: SpaceSessionResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;

  @ApiProperty({
    description: '是否还有下一页（恒等于 nextCursor 非空）',
    example: false,
  })
  @IsBoolean({ message: 'hasMore 必须是布尔值' })
  hasMore: boolean;

  @ApiProperty({
    description:
      '下一页游标，null 表示已到底；原样回传给下次请求的 cursor 参数',
    type: String,
    nullable: true,
  })
  @IsOptional()
  @IsString({ message: 'nextCursor 必须是字符串' })
  nextCursor: string | null;
}
