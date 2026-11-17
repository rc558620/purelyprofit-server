import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNumber,
  IsString,
  ValidateNested,
} from 'class-validator';
import type { CustodyStockModeValue } from '../custody.domain';

/** 门店客存配置 */
export class CustodySettingsDto {
  /** 是否启用客存 */
  @ApiProperty({ description: '是否启用客存' })
  @IsBoolean({ message: '是否启用客存必须是布尔值' })
  enabled!: boolean;

  /** 库存口径 */
  @ApiProperty({ description: '库存口径', enum: ['sold', 'frozen'] })
  @IsString({ message: '库存口径必须是字符串' })
  stockMode!: CustodyStockModeValue;

  /** 默认有效期天数，null 表示长期有效 */
  @ApiProperty({ description: '默认有效期天数，null 表示长期有效' })
  @IsNumber({}, { message: '默认有效期天数必须是数字' })
  defaultExpireDays!: number | null;

  /** 跨店通取（一期恒为 false） */
  @ApiProperty({ description: '是否允许跨店通取（一期恒为 false）' })
  @IsBoolean({ message: '跨店通取开关必须是布尔值' })
  allowCrossStorePickup!: boolean;

  /** 是否需要客户确认存入 */
  @ApiProperty({ description: '是否需要客户确认存入' })
  @IsBoolean({ message: '是否需要客户确认必须是布尔值' })
  requireMemberConfirm!: boolean;

  /** 取出核验开关：开启后核销必须再核对会员手机号后四位 */
  @ApiProperty({ description: '取出时是否强制核对会员手机号后四位' })
  @IsBoolean({ message: '取出核验开关必须是布尔值' })
  pickupPhoneVerifyEnabled!: boolean;

  /** 单价阈值（单位：分），null 表示不按阈值触发 */
  @ApiProperty({
    description: '商品单价阈值（单位：分），null 表示不按阈值触发',
  })
  @IsNumber({}, { message: '单价阈值必须是数字或 null' })
  pickupPhoneVerifyThreshold!: number | null;

  /** 可选计量单位列表 */
  @ApiProperty({ description: '可选计量单位列表' })
  @IsArray({ message: '单位选项必须是数组' })
  @IsString({ each: true, message: '单位选项必须是字符串' })
  unitOptions!: string[];
}

/** 门店配置响应 */
export class CustodySettingsResponseDto {
  /** 门店客存配置 */
  @ApiProperty({ type: CustodySettingsDto })
  @ValidateNested()
  @Type(() => CustodySettingsDto)
  settings!: CustodySettingsDto;
}
