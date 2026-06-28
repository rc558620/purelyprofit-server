import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MinLength } from 'class-validator';

export class RegisterDto {
  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @ApiProperty({ example: '123456', description: '6 位注册验证码' })
  @IsString({ message: '验证码必须是字符串' })
  @Matches(/^\d{6}$/, { message: '验证码必须为 6 位数字' })
  code: string;

  @ApiProperty({ example: 'password123', description: '登录密码（明文或 RSA 加密密文）' })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(1, { message: '密码不能为空' })
  password: string;

  @ApiProperty({ example: 'password123', description: '确认密码' })
  @IsString({ message: '确认密码必须是字符串' })
  confirmPassword: string;

  @ApiPropertyOptional({ example: '老板', description: '用户名' })
  @IsOptional()
  @IsString({ message: '用户名必须是字符串' })
  name?: string;
}
