import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @ApiProperty({ example: '123456', description: '6 位重置验证码' })
  @IsString({ message: '验证码必须是字符串' })
  @Matches(/^\d{6}$/, { message: '验证码必须为 6 位数字' })
  code: string;

  @ApiProperty({ example: 'newPassword123', description: '新密码（明文或 RSA 加密密文）' })
  @IsString({ message: '新密码必须是字符串' })
  @MinLength(1, { message: '新密码不能为空' })
  password: string;

  @ApiProperty({ example: 'newPassword123', description: '确认新密码' })
  @IsString({ message: '确认新密码必须是字符串' })
  confirmPassword: string;
}
