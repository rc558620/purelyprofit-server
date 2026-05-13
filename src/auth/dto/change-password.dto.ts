import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';

export class ChangePasswordDto {
  @ApiProperty({ example: 'password123', description: '当前密码' })
  @IsString({ message: '当前密码必须是字符串' })
  @MinLength(6, { message: '当前密码至少 6 位' })
  oldPassword: string;

  @ApiProperty({ example: 'newPassword123', description: '新密码' })
  @IsString({ message: '新密码必须是字符串' })
  @MinLength(6, { message: '新密码至少 6 位' })
  newPassword: string;

  @ApiPropertyOptional({ example: 'newPassword123', description: '确认新密码' })
  @IsOptional()
  @IsString({ message: '确认新密码必须是字符串' })
  confirmPassword?: string;
}
