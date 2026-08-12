import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';

/** 更新服务呼叫语音播报配置（支持部分更新：只更新传入的字段）。 */
export class UpdateServiceCallVoiceSettingsDto {
  @ApiPropertyOptional({ description: '服务呼叫语音播报开关（默认关闭）' })
  @IsOptional()
  @IsBoolean({ message: 'serviceCallVoiceEnabled 必须是布尔值' })
  serviceCallVoiceEnabled?: boolean;
}
