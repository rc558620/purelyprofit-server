import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, Min } from 'class-validator';
import type { SpacePrintChannel } from '../space-print-settings.service';

/** 空间小票打印通道可选值：浏览器系统打印 / 飞鹅云打印 / 服务器本地 USB 打印 / 关闭。 */
const SPACE_PRINT_CHANNELS: SpacePrintChannel[] = ['browser', 'cloud', 'usb', 'off'];

/** 更新空间消费小票打印配置（支持部分更新：只更新传入的字段）。 */
export class UpdateSpacePrintSettingsDto {
  @ApiPropertyOptional({
    description: '空间消费小票打印通道（browser/cloud/usb/off）',
    example: 'cloud',
  })
  @IsOptional()
  @IsIn(SPACE_PRINT_CHANNELS, {
    message: 'spacePrintChannel 必须是 browser/cloud/usb/off 之一',
  })
  spacePrintChannel?: SpacePrintChannel;

  @ApiPropertyOptional({
    description: '空间消费小票飞鹅云打印机 SN（spacePrintChannel=cloud 时必填）',
    example: '9123456789',
  })
  @IsOptional()
  @IsString({ message: 'spaceCloudPrinterSn 必须是字符串' })
  @MaxLength(64, { message: 'spaceCloudPrinterSn 不能超过 64 个字符' })
  spaceCloudPrinterSn?: string | null;

  @ApiPropertyOptional({
    description: '空间消费小票 USB 打印机标识（spacePrintChannel=usb 时使用，留空自动探测）',
    example: '/dev/usb/lp0',
  })
  @IsOptional()
  @IsString({ message: 'spaceUsbPrinter 必须是字符串' })
  @MaxLength(128, { message: 'spaceUsbPrinter 不能超过 128 个字符' })
  spaceUsbPrinter?: string | null;
}

/** 下发空间消费小票打印任务入参：按结账生成的销售订单 ID 打印。 */
export class SpacePrintOrderDto {
  @ApiProperty({
    description: '空间会话结账生成的销售订单 ID（saleOrderId）',
    example: 1024,
  })
  @IsInt({ message: 'saleOrderId 必须是整数' })
  @Min(1, { message: 'saleOrderId 必须大于 0' })
  saleOrderId!: number;
}
