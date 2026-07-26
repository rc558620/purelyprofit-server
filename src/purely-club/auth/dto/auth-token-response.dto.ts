import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNumber, IsOptional, IsString } from 'class-validator';

export class AuthTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy',
    description: 'purely-club 访问令牌',
  })
  @IsString({ message: '访问令牌必须是字符串' })
  access_token: string;

  @ApiPropertyOptional({
    example: 'rt_abc123def456...',
    description: '刷新令牌（一次性使用，用于获取新的 access_token）',
  })
  @IsOptional()
  @IsString({ message: '刷新令牌必须是字符串' })
  refresh_token?: string;

  @ApiPropertyOptional({
    example: 7200,
    description: 'access_token 有效期（秒）',
  })
  @IsOptional()
  @IsNumber({}, { message: '有效期必须是数字' })
  expires_in?: number;

  @ApiPropertyOptional({
    example: 1,
    description: '签发 token 对应的用户 ID',
  })
  @IsOptional()
  @IsNumber({}, { message: '用户 ID 必须是数字' })
  userId?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      '是否需要绑定手机号。' +
      '微信登录后若账号尚未绑定真实手机号，此字段为 true，前端应跳转绑定手机号页面。',
  })
  needPhoneBind?: boolean;
}
