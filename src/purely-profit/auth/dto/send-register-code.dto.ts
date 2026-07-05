import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

export class SendRegisterCodeDto {
  @ApiProperty({ example: '13800138000', description: '手机号' })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '手机号格式不正确' })
  phone: string;

  /** 拼图验证令牌：前端完成拼图验证后生成，后端校验通过后才允许发送短信 */
  @ApiPropertyOptional({
    example: 'puzzle_1719500000000_1',
    description: '拼图验证令牌，前端通过拼图人机校验后携带',
  })
  @IsOptional()
  @IsString({ message: 'captchaToken 必须是字符串' })
  captchaToken?: string;
}
