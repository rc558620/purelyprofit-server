import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import type { SmsMode } from '../auth.constants';

/** 切换短信通道模式请求（仅非生产环境可用的调试接口）。 */
export class UpdateSmsModeDto {
  @ApiProperty({
    example: 'live',
    description: '目标短信通道模式：mock=测试模式（仅打印日志）/ live=真实发送',
  })
  @IsString({ message: '短信通道模式必须是字符串' })
  @IsIn(['mock', 'live'], { message: '短信通道模式只能是 mock 或 live' })
  mode: SmsMode;
}
