import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';
import { extractSpaceQrToken } from '../../shared/space-qr-token.utils';

/**
 * 空间码 token 先提取再校验。
 *
 * 整条扫码 URL（`{base}/p/{token}`）远超 64 字符，若先校验长度会被拦成 400，
 * 顾客看到「二维码无效」而纸上的码其实没坏。所以在 pipe 里先把 URL 还原成
 * token，再走长度校验；非字符串原样放行，交给 `@IsString` 报错。
 */
const normalizeSpaceToken = ({ value }: { value: unknown }): unknown =>
  typeof value === 'string' ? extractSpaceQrToken(value) : value;

export class ResolveSpaceDto {
  @ApiProperty({
    description:
      '空间二维码中的稳定令牌；也接受整条扫码 URL（服务端会自行提取 token）',
    minLength: 1,
    maxLength: 512,
  })
  @Transform(normalizeSpaceToken)
  @IsString({ message: 'spaceToken 必须是字符串' })
  @MaxLength(512, { message: 'spaceToken 不合法' })
  spaceToken: string;
}
