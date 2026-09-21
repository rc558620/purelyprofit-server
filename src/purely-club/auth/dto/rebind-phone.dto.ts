import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length, Matches } from 'class-validator';

export class RebindPhoneDto {
  @ApiProperty({
    example: '13800138000',
    description: '换绑后的新手机号（大陆 11 位）',
  })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的手机号' })
  phone: string;

  @ApiProperty({
    example: '123456',
    description:
      '新手机号的短信验证码（来自 POST /club/auth/bind-phone/send-code）',
  })
  @IsString({ message: '验证码必须是字符串' })
  @Length(4, 6, { message: '验证码长度为 4-6 位' })
  code: string;
}
