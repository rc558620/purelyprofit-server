import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
} from 'class-validator';

export class WechatLoginDto {
  @ApiProperty({
    example: '023xxxxxxxabc',
    description:
      '微信小程序 wx.login() 返回的 code，服务端将用其换取 openid/session_key',
  })
  @IsString({ message: 'code 必须是字符串' })
  @MinLength(1, { message: 'code 不能为空' })
  code: string;

  @ApiPropertyOptional({
    example: '0123xxxxphone',
    description:
      '微信手机号授权 code（前端 Button open-type=getPhoneNumber 回调中的 e.detail.code）。' +
      '服务端将用其向微信换取用户真实手机号，并与已有手机号账号合并（若存在）。' +
      '不传则不绑定手机号，仍可通过 openid 完成登录。',
  })
  @IsOptional()
  @IsString({ message: 'phoneCode 必须是字符串' })
  @MinLength(1, { message: 'phoneCode 不能为空字符串' })
  phoneCode?: string;

  @ApiPropertyOptional({
    example: '小明',
    description:
      '微信昵称（前端通过 wx.getUserProfile 获取），首次注册时写入，后续登录时刷新',
  })
  @IsOptional()
  @IsString({ message: '昵称必须是字符串' })
  @MaxLength(64, { message: '昵称不能超过 64 个字符' })
  nickname?: string;

  @ApiPropertyOptional({
    example: 'https://thirdwx.qlogo.cn/mmopen/xxx/0',
    description:
      '微信头像 URL（前端通过 wx.getUserProfile 获取），首次注册时写入，后续登录时刷新',
  })
  @IsOptional()
  @IsString({ message: '头像地址必须是字符串' })
  @IsUrl({}, { message: '头像地址格式不正确' })
  avatar?: string;
}
