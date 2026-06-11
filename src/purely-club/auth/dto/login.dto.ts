import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength, ValidateIf } from 'class-validator';

export class LoginDto {
  @ApiPropertyOptional({
    example: '13800138000',
    description: '手机号，兼容旧版 purely-club 登录字段',
  })
  @ValidateIf((dto: LoginDto) => !dto.account)
  @IsString({ message: '手机号必须是字符串' })
  @IsOptional()
  phone?: string;

  @ApiPropertyOptional({
    example: 'club_user_01',
    description: '登录账号别名，兼容后续 purely-club 多账号形态',
  })
  @ValidateIf((dto: LoginDto) => !dto.phone)
  @IsString({ message: '登录账号必须是字符串' })
  @MinLength(1, { message: '登录账号不能为空' })
  @IsOptional()
  account?: string;

  @ApiProperty({ example: 'password123', description: '密码' })
  @IsString({ message: '密码必须是字符串' })
  @MinLength(6, { message: '密码至少 6 位' })
  password: string;
}
