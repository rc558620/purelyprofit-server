import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ValidateNested } from 'class-validator';
import {
  SpaceSessionRenewRecordResponseDto,
  SpaceSessionResponseDto,
} from './space-session-shared.response.dto';

export class RenewSpaceSessionResponseDto {
  @ApiProperty({
    type: () => SpaceSessionRenewRecordResponseDto,
    description: '本次续费记录',
  })
  @ValidateNested()
  @Type(() => SpaceSessionRenewRecordResponseDto)
  renewRecord: SpaceSessionRenewRecordResponseDto;

  @ApiProperty({
    type: () => SpaceSessionResponseDto,
    description: '续费后的会话信息',
  })
  @ValidateNested()
  @Type(() => SpaceSessionResponseDto)
  session: SpaceSessionResponseDto;
}
