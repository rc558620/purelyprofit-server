import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class SendRegisterCodeResponseDto {
  @ApiProperty({
    example: '验证码已发送，请注意查收',
    description: '操作结果说明',
  })
  @IsString({ message: '操作结果说明必须是字符串' })
  message: string;

  @ApiProperty({ example: 600, description: '验证码有效期，单位秒' })
  @IsInt({ message: '验证码有效期必须是整数' })
  @Min(1, { message: '验证码有效期必须大于 0' })
  expiresInSeconds: number;

  @ApiPropertyOptional({
    example: '123456',
    description: '开发环境下返回的 purely-club 注册验证码',
  })
  @IsOptional()
  @IsString({ message: '注册验证码必须是字符串' })
  code?: string;
}
