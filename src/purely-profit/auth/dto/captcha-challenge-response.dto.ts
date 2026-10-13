import { ApiProperty } from '@nestjs/swagger';

export class CaptchaChallengeResponseDto {
  @ApiProperty({
    description:
      '服务端颁发的拼图验证令牌，完成拼图后需随登录/发送验证码请求回传，一次性消费，有效期 5 分钟',
    example: 'puzzle_1760000000000_1a2b3c4d5e6f7a8b',
  })
  captchaToken: string;
}
