import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

export class ForgotPasswordDto {
  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1\d{10}$/, { message: '手机号格式不正确' })
  phone: string;
}
