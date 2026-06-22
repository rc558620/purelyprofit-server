import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class AuthTokenResponseDto {
  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy',
    description: 'purely-club 访问令牌',
  })
  access_token: string;

  @ApiPropertyOptional({
    example: true,
    description:
      '是否需要绑定手机号。' +
      '微信登录后若账号尚未绑定真实手机号，此字段为 true，前端应跳转绑定手机号页面。',
  })
  needPhoneBind?: boolean;
}
