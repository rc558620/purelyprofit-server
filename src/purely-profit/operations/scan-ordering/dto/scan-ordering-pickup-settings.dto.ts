import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** 更新扫码点餐取餐语音播报开关。 */
export class UpdateScanOrderingPickupSettingsDto {
  @ApiProperty({ description: '语音播报开关（默认关闭）' })
  @IsBoolean({ message: 'pickupVoiceEnabled 必须是布尔值' })
  pickupVoiceEnabled: boolean;
}
