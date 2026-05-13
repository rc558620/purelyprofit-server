import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  @ApiProperty({ example: 'password123', description: '密码' })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;
}
