import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { PrintChannel } from '../scan-ordering-print-settings.service';

/** 打印通道可选值：浏览器系统打印 / 飞鹅云打印 / 服务器本地 USB 打印 / 关闭。 */
const PRINT_CHANNELS: PrintChannel[] = ['browser', 'cloud', 'usb', 'off'];

/** 更新扫码点餐打印配置（支持部分更新：只更新传入的字段）。 */
export class UpdateScanOrderingPrintSettingsDto {
  @ApiPropertyOptional({
    description: '收银台顾客票打印通道（browser/cloud/usb/off）',
  })
  @IsOptional()
  @IsIn(PRINT_CHANNELS, {
    message: 'cashierPrintChannel 必须是 browser/cloud/usb/off 之一',
  })
  cashierPrintChannel?: PrintChannel;

  @ApiPropertyOptional({
    description: '后厨制作单打印通道（browser/cloud/usb/off）',
  })
  @IsOptional()
  @IsIn(PRINT_CHANNELS, {
    message: 'kitchenPrintChannel 必须是 browser/cloud/usb/off 之一',
  })
  kitchenPrintChannel?: PrintChannel;

  @ApiPropertyOptional({
    description: '收银台飞鹅云打印机 SN（channel=cloud 时必填）',
  })
  @IsOptional()
  @IsString({ message: 'cashierCloudPrinterSn 必须是字符串' })
  @MaxLength(64, { message: 'cashierCloudPrinterSn 不能超过 64 个字符' })
  cashierCloudPrinterSn?: string | null;

  @ApiPropertyOptional({
    description: '后厨飞鹅云打印机 SN（channel=cloud 时必填）',
  })
  @IsOptional()
  @IsString({ message: 'kitchenCloudPrinterSn 必须是字符串' })
  @MaxLength(64, { message: 'kitchenCloudPrinterSn 不能超过 64 个字符' })
  kitchenCloudPrinterSn?: string | null;

  @ApiPropertyOptional({
    description:
      '收银台 USB 小票打印机标识（channel=usb 时使用；Linux 设备路径如 /dev/usb/lp0 或 CUPS 打印机名，留空自动探测）',
  })
  @IsOptional()
  @IsString({ message: 'cashierUsbPrinter 必须是字符串' })
  @MaxLength(128, { message: 'cashierUsbPrinter 不能超过 128 个字符' })
  cashierUsbPrinter?: string | null;

  @ApiPropertyOptional({
    description: '后厨 USB 小票打印机标识（channel=usb 时使用）',
  })
  @IsOptional()
  @IsString({ message: 'kitchenUsbPrinter 必须是字符串' })
  @MaxLength(128, { message: 'kitchenUsbPrinter 不能超过 128 个字符' })
  kitchenUsbPrinter?: string | null;
}
