import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsString } from 'class-validator';
import type { SmsMode } from '../auth.constants';

/** 短信通道模式响应（仅非生产环境可用的调试接口）。 */
export class SmsModeResponseDto {
  @ApiProperty({
    example: 'mock',
    description: '当前短信通道模式：mock=测试模式（仅打印日志）/ live=真实发送',
  })
  @IsString({ message: '短信通道模式必须是字符串' })
  @IsIn(['mock', 'live'], { message: '短信通道模式只能是 mock 或 live' })
  mode: SmsMode;

  @ApiProperty({
    example: true,
    description: '当前环境是否允许运行期切换通道（生产环境恒为 false）',
  })
  @IsBoolean({ message: 'switchEnabled 必须是布尔值' })
  switchEnabled: boolean;

  @ApiProperty({
    example: true,
    description: '服务端是否已配置切换访问令牌；未配置时切换请求一律拒绝',
  })
  @IsBoolean({ message: 'devTokenConfigured 必须是布尔值' })
  devTokenConfigured: boolean;

  @ApiProperty({
    example: false,
    description:
      '是否配置了 live 通道手机号白名单；启用白名单后名单外手机号一律降级为测试模式',
  })
  @IsBoolean({ message: 'liveWhitelistEnabled 必须是布尔值' })
  liveWhitelistEnabled: boolean;
}
