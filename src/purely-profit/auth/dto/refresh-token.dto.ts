import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class RefreshTokenDto {
  @ApiProperty({
    description: '刷新令牌（一次性使用，刷新后自动轮换）',
    example: 'rt_abc123def456...',
  })
  @IsString({ message: '刷新令牌必须是字符串' })
  refresh_token: string;
}
