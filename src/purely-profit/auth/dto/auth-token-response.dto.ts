import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsString } from 'class-validator';

export class AuthTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy',
    description: '访问令牌',
  })
  @IsString({ message: '访问令牌必须是字符串' })
  access_token: string;

  @ApiPropertyOptional({
    example: 1,
    description: '签发 token 对应的用户 ID',
  })
  @IsNumber({}, { message: '用户 ID 必须是数字' })
  userId?: number;
}
