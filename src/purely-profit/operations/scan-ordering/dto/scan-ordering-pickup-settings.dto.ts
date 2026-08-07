import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** 更新扫码点餐取餐配置（支持部分更新：只更新传入的字段）。 */
export class UpdateScanOrderingPickupSettingsDto {
  @ApiPropertyOptional({ description: '语音播报开关（默认关闭）' })
  @IsOptional()
  @IsBoolean({ message: 'pickupVoiceEnabled 必须是布尔值' })
  pickupVoiceEnabled?: boolean;

  @ApiPropertyOptional({ description: '出餐自动打印开关（默认关闭）' })
  @IsOptional()
  @IsBoolean({ message: 'serveAutoPrintEnabled 必须是布尔值' })
  serveAutoPrintEnabled?: boolean;
}
