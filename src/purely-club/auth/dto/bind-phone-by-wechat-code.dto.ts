import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * 微信 getPhoneNumber 一键绑定手机号入参。
 *
 * `code` 来自 `<Button open-type="getPhoneNumber">` 回调的 `e.detail.code`，
 * 由服务端调用微信 `phonenumber.getPhoneNumber` 换取真实手机号。
 *
 * 该 code 有效期 5 分钟且**一次性**；换取失败时必须让用户重新触发授权。
 * 外泄风险低于短信验证码：code 只有在服务端用 access_token 才能兑换，
 * 且绑定接口本身要求 JWT 鉴权——攻击者拿到 code 也只能绑定到自己账号上。
 */
export class BindPhoneByWechatCodeDto {
  @ApiProperty({
    example: 'e0a1b2c3-d4e5-f6a7-b8c9-d0e1f2a3b4c5',
    description: '微信手机号授权凭证（e.detail.code），5 分钟内一次有效',
  })
  @IsString({ message: '授权凭证必须是字符串' })
  @MinLength(1, { message: '授权凭证不能为空' })
  code: string;
}
