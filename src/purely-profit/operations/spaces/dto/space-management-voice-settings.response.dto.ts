import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

/** 空间管理语音播报门店配置响应。 */
export class SpaceManagementVoiceSettingsResponseDto {
  @ApiProperty({
    type: Boolean,
    example: false,
    description: '空间管理语音播报开关（门店级配置，默认关闭）',
  })
  @IsBoolean({ message: '空间管理语音播报开关必须为布尔值' })
  spaceManagementVoiceEnabled: boolean;
}
