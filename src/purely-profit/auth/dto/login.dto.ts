import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  Matches,
  MinLength,
  ValidateIf,
} from 'class-validator';

/** captchaToken 格式正则，与 CaptchaTokenService 中的正则保持一致 */
const CAPTCHA_TOKEN_PATTERN = /^puzzle_\d+_[a-z0-9]+$/;

export class LoginDto {
  @ApiPropertyOptional({
    example: '13800138000',
    description: '手机号，兼容旧版登录字段',
  })
  @ValidateIf((dto: LoginDto) => !dto.account)
  @IsString({ message: '手机号必须是字符串' })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    example: 'admin',
    description: '登录账号别名，支持 admin 或子账号自定义账号',
  })
  @ValidateIf((dto: LoginDto) => !dto.phone)
  @IsString({ message: '登录账号必须是字符串' })
  @MinLength(1, { message: '登录账号不能为空' })
  @IsOptional()
  account?: string;

  @ApiProperty({
    example: 'password123',
    description: '密码（明文或 RSA 加密密文）',
  })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(1, { message: '密码不能为空' })
  password: string;

  @ApiPropertyOptional({
    example: 'puzzle_1719500000000_abc123',
    description: '拼图验证令牌，前端完成拼图验证后生成并注册到服务端',
  })
  @IsString({ message: 'captchaToken 必须是字符串' })
  @Matches(CAPTCHA_TOKEN_PATTERN, { message: 'captchaToken 格式不合法' })
  @IsOptional()
  captchaToken?: string;
}
