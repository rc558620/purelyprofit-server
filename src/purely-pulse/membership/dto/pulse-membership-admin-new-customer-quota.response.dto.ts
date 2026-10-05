// Pulse / 新客额度管理响应 DTO
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/** 门店新客额度现状（身份展示门店主账号，而非门店名） */
export class PulseAdminNewCustomerQuotaStoreDto {
  @ApiProperty({ example: '1', description: '会员 ID / 门店 ID' })
  @IsString()
  storeId: string;

  @ApiProperty({ example: '纯利宝南山店', description: '门店名称' })
  @IsString()
  storeName: string;

  @ApiProperty({ example: '张三', description: '主账号昵称' })
  @IsString()
  ownerName: string;

  @ApiProperty({
    example: '13800138000',
    description: '主账号手机号，取不到时为空串',
  })
  @IsString()
  ownerPhone: string;

  @ApiPropertyOptional({
    example: 'https://cdn.example.com/avatar.jpg',
    description: '主账号头像 URL，未设置时为空串',
  })
  @IsOptional()
  @IsString()
  ownerAvatarUrl?: string;

  @ApiProperty({ example: 120, description: '剩余新客额度（位新客）' })
  @IsInt()
  remaining: number;

  @ApiProperty({ example: 36, description: '累计已服务新客数（只增不减）' })
  @IsInt()
  consumed: number;

  @ApiProperty({ example: 100, description: '额度预警阈值（位新客）' })
  @IsInt()
  warningThreshold: number;

  @ApiPropertyOptional({
    example: 1747123200000,
    description: '额度最近更新时间戳（ms）；门店无档案时为 null',
  })
  @IsOptional()
  @IsInt()
  updatedAt?: number | null;
}

export class PulseAdminNewCustomerQuotaStoresResponseDto {
  @ApiProperty({
    type: [PulseAdminNewCustomerQuotaStoreDto],
    description: '管理员视角可访问门店的新客额度列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminNewCustomerQuotaStoreDto)
  items: PulseAdminNewCustomerQuotaStoreDto[];
}
