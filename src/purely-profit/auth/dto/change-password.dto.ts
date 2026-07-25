import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({
    example: 'password123',
    description: '当前密码（明文或 RSA 加密密文）',
  })
  @IsString({ message: '当前密码必须是字符串' })
  @MinLength(1, { message: '当前密码不能为空' })
  currentPassword: string;

  @ApiProperty({
    example: 'newPassword123',
    description: '新密码（明文或 RSA 加密密文）',
  })
  @IsString({ message: '新密码必须是字符串' })
  @MinLength(1, { message: '新密码不能为空' })
  newPassword: string;

  @ApiProperty({ example: 'newPassword123', description: '确认新密码' })
  @IsString({ message: '确认新密码必须是字符串' })
  confirmPassword: string;
}
