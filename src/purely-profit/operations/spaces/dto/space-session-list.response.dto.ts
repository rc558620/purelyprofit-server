import { ApiProperty } from '@nestjs/swagger';
import { PaginationMetaDto } from '../../../stores/dto/store-response.dto';
import { SpaceSessionResponseDto } from './space-session-shared.response.dto';

export class PaginatedSpaceSessionsResponseDto {
  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    isArray: true,
    description: '会话列表',
  })
  items: SpaceSessionResponseDto[];

  @ApiProperty({ type: PaginationMetaDto, description: '分页元信息' })
  meta: PaginationMetaDto;
}
