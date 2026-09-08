import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

export class ResolveSpaceDto {
  @ApiProperty({
    description: '空间二维码中的稳定令牌',
    minLength: 1,
    maxLength: 64,
  })
  @IsString({ message: 'spaceToken 必须是字符串' })
  @MaxLength(64, { message: 'spaceToken 不合法' })
  spaceToken: string;
}
