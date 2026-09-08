import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** 更新空间管理语音播报配置（支持部分更新：只更新传入的字段）。 */
export class UpdateSpaceManagementVoiceSettingsDto {
  @ApiPropertyOptional({ description: '空间管理语音播报开关（默认关闭）' })
  @IsOptional()
  @IsBoolean({ message: 'spaceManagementVoiceEnabled 必须是布尔值' })
  spaceManagementVoiceEnabled?: boolean;
}
