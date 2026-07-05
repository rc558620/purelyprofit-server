// 拼图验证令牌注册 DTO：前端完成拼图验证后，调用注册接口将 token 存入 Redis
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** captchaToken 格式正则，与 CaptchaTokenService 中的正则保持一致 */
const CAPTCHA_TOKEN_PATTERN = /^puzzle_\d+_[a-z0-9]+$/;

export class RegisterCaptchaTokenDto {
  @ApiProperty({
    example: 'puzzle_1719500000000_1',
    description: '前端拼图验证成功后生成的令牌',
  })
  @IsString({ message: 'captchaToken 必须是字符串' })
  @Matches(CAPTCHA_TOKEN_PATTERN, { message: 'captchaToken 格式不合法' })
  captchaToken: string;
}
