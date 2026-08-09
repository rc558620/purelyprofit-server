import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

/** 打印代理注册平台。 */
export type PrintAgentPlatform = 'windows' | 'darwin' | 'linux';

/** 打印代理注册平台可选值。 */
const AGENT_PLATFORMS: PrintAgentPlatform[] = ['windows', 'darwin', 'linux'];

/** 打印代理注册请求：客户在门店电脑上的代理中输入绑定码，换取代理令牌。 */
export class PrintAgentRegisterDto {
  @ApiProperty({ description: '门店绑定码（商家端扫码点餐设置页生成）' })
  @IsString({ message: 'bindCode 必须是字符串' })
  @Length(6, 16, { message: 'bindCode 长度需在 6-16 位之间' })
  bindCode: string;

  @ApiPropertyOptional({ description: '代理运行平台（windows/darwin/linux）' })
  @IsOptional()
  @IsIn(AGENT_PLATFORMS, {
    message: 'platform 必须是 windows/darwin/linux 之一',
  })
  platform?: PrintAgentPlatform;

  @ApiPropertyOptional({ description: '代理版本号' })
  @IsOptional()
  @IsString({ message: 'version 必须是字符串' })
  @MaxLength(32, { message: 'version 不能超过 32 个字符' })
  version?: string;
}

/** 打印代理注册响应。 */
export interface PrintAgentRegisterResult {
  /** 代理令牌（后续 WebSocket 鉴权使用，妥善保存）。 */
  token: string;
  /** 绑定门店 ID。 */
  storeId: number;
}
