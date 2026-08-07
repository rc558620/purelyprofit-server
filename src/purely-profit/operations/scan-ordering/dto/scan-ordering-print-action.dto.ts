import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';
import type { CloudPrintTarget } from '../scan-ordering-cloud-print.service';

/** 云打印目标可选值。 */
const PRINT_TARGETS: CloudPrintTarget[] = ['cashier', 'kitchen'];

/** 云打印下单请求：指定目标与订单。 */
export class ScanOrderingPrintOrderDto {
  @ApiProperty({ description: '云打印目标（cashier=收银台顾客票 / kitchen=后厨制作单）' })
  @IsIn(PRINT_TARGETS, { message: 'target 必须是 cashier/kitchen 之一' })
  target: CloudPrintTarget;

  @ApiProperty({ description: '订单 ID' })
  @IsInt({ message: 'orderId 必须是整数' })
  @Min(1, { message: 'orderId 必须大于 0' })
  orderId: number;
}

/** 云打印测试请求：指定目标。 */
export class ScanOrderingPrintTestDto {
  @ApiProperty({ description: '云打印目标（cashier=收银台顾客票 / kitchen=后厨制作单）' })
  @IsIn(PRINT_TARGETS, { message: 'target 必须是 cashier/kitchen 之一' })
  target: CloudPrintTarget;

  @ApiPropertyOptional({ description: '预留：指定打印机 SN（不传则使用门店已配置 SN）' })
  @IsOptional()
  @IsString({ message: 'sn 必须是字符串' })
  sn?: string;
}
