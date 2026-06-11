import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class LoginByCodeDto {
  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @ApiProperty({ example: '123456', description: '短信验证码' })
  @IsString({ message: '验证码必须是字符串' })
  @Matches(/^\d{4,6}$/, { message: '验证码格式不正确' })
  code: string;
}
