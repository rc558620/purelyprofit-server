import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class PasswordOperationResponseDto {
  @ApiProperty({
    example: '密码操作成功，旧登录态已失效',
    description: '操作结果说明',
  })
  @IsString({ message: '操作结果说明必须是字符串' })
  message: string;

  @ApiProperty({
    example: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.xxx.yyy',
    description: '重新签发的 purely-club 访问令牌',
  })
  @IsString({ message: '访问令牌必须是字符串' })
  access_token: string;
}
