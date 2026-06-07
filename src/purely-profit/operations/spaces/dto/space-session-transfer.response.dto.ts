import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, ValidateNested } from 'class-validator';
import {
  SPACE_STATUS_VALUES,
  type SpaceStatusValue,
} from '../spaces.constants';
import { SpaceSessionResponseDto } from './space-session-shared.response.dto';

export class TransferSpaceSessionResponseDto {
  @ApiProperty({ example: true, description: '是否换房成功' })
  @IsBoolean()
  ok: boolean;

  @ApiPropertyOptional({
    example: '目标空间当前不可换入',
    description:
      '换房失败原因（ok=false 时后端通过异常返回，保留此字段供前端接口类型对齐）',
  })
  reason?: string;

  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    description: '换房后的会话信息',
  })
  @ValidateNested()
  @Type(() => SpaceSessionResponseDto)
  session: SpaceSessionResponseDto;

  @ApiProperty({
    example: 'idle',
    description: '原空间回流后的状态',
    enum: SPACE_STATUS_VALUES,
  })
  sourceSpaceStatus: SpaceStatusValue;

  @ApiProperty({
    example: 'occupied',
    description: '目标空间状态',
    enum: SPACE_STATUS_VALUES,
  })
  targetSpaceStatus: SpaceStatusValue;
}
