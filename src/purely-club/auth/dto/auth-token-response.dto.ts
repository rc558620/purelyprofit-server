import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AuthTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy',
    description: 'purely-club 访问令牌',
  })
  @IsString({ message: '访问令牌必须是字符串' })
  access_token: string;
}
