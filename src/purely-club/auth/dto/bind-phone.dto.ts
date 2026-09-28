import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Min,
} from 'class-validator';

export class BindPhoneDto {
  @ApiProperty({
    example: '13800138000',
    description: '待绑定的手机号（大陆 11 位）',
  })
  @IsString({ message: '手机号必须是字符串' })
  @Matches(/^1[3-9]\d{9}$/, { message: '请输入正确的手机号' })
  phone: string;

  @ApiProperty({
    example: '123456',
    description: '短信验证码（来自 POST /club/auth/bind-phone/send-code）',
  })
  @IsString({ message: '验证码必须是字符串' })
  @Length(4, 6, { message: '验证码长度为 4-6 位' })
  code: string;

  /**
   * 扫码点餐会话 ID（可选）。
   *
   * 用于定位「额度归属门店」：绑定会按「本店是否服务过该顾客」扣减门店新客额度，
   * 而用户可能是从扫码点餐流程被引导到本页的——此时以**扫码进的那家店**为准，
   * 不能用「当前选中门店」，否则额度会记到别的门店头上。
   * 未传（从个人中心进入绑定页等）时退回「当前选中门店」。
   */
  @ApiPropertyOptional({
    example: 9527,
    description:
      '扫码点餐会话 ID，用于按「扫码进的那家店」判定额度归属门店；缺省时按当前选中门店',
  })
  @IsOptional()
  @IsInt({ message: 'sessionId 必须是整数' })
  @Min(1, { message: 'sessionId 必须为正整数' })
  sessionId?: number;
}
