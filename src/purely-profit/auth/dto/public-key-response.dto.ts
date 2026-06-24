import { ApiProperty } from '@nestjs/swagger';

export class PublicKeyResponseDto {
  @ApiProperty({
    description: 'PEM 格式 RSA 公钥，前端用于加密密码等敏感字段',
    example: '-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END PUBLIC KEY-----',
  })
  publicKey: string;
}
