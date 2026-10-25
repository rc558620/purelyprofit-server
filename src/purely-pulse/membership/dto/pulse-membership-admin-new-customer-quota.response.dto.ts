// Pulse / 新客额度管理响应 DTO
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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

/**
 * 额度门店统计概览（后端权威计算，前端仅展示）。
 *
 * 统计口径为**当前搜索关键词过滤后的完整门店集合**：与分页切片无关，
 * 也不随健康度 Tab 变化（切到「已耗尽」时概览仍展示全局口径，避免恒为 0）。
 */
export class PulseAdminNewCustomerQuotaStoresStatsDto {
  @ApiProperty({ example: 12, description: '当前筛选条件下的门店总数' })
  @IsInt()
  storeCount: number;

  @ApiProperty({ example: 9962, description: '剩余新客额度合计（位新客）' })
  @IsInt()
  totalRemaining: number;

  @ApiProperty({ example: 0, description: '额度预警门店数' })
  @IsInt()
  warningCount: number;

  @ApiProperty({ example: 0, description: '额度已耗尽门店数（未发放不计入）' })
  @IsInt()
  exhaustedCount: number;
}

export class PulseAdminNewCustomerQuotaStoresResponseDto {
  @ApiProperty({
    type: [PulseAdminNewCustomerQuotaStoreDto],
    description: '当前页门店新客额度列表',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminNewCustomerQuotaStoreDto)
  items: PulseAdminNewCustomerQuotaStoreDto[];

  @ApiProperty({ example: 12, description: '当前筛选条件下的门店总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码（从 1 开始）' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页条数' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  @IsBoolean()
  hasMore: boolean;

  @ApiProperty({
    type: PulseAdminNewCustomerQuotaStoresStatsDto,
    description: '统计概览（按当前筛选条件的完整门店集合计算，与分页无关）',
  })
  @ValidateNested()
  @Type(() => PulseAdminNewCustomerQuotaStoresStatsDto)
  stats: PulseAdminNewCustomerQuotaStoresStatsDto;
}

/** 额度变动记录条目（一条额度流水） */
export class PulseAdminNewCustomerQuotaLogDto {
  @ApiProperty({ example: '1024', description: '流水 ID' })
  @IsString()
  id: string;

  @ApiProperty({ example: '12', description: '门店 ID' })
  @IsString()
  storeId: string;

  @ApiProperty({
    enum: ['recharge', 'grant', 'consume', 'clear', 'admin_adjust'],
    description:
      '变动类型：recharge=商家充值，grant=会员赠送，consume=新客消耗，' +
      'clear=额度清零，admin_adjust=平台运营调整',
  })
  @IsString()
  type: string;

  @ApiProperty({ example: 100, description: '变动数量：正数增加，负数减少' })
  @IsInt()
  changeAmount: number;

  @ApiProperty({ example: 320, description: '变动后的余额（位新客）' })
  @IsInt()
  balanceAfter: number;

  @ApiPropertyOptional({
    example: 1000,
    description: '充值金额（分），仅 recharge 流水有值',
  })
  @IsOptional()
  @IsInt()
  amountFen?: number | null;

  @ApiProperty({ example: '平台运营发放活动额度', description: '流水说明' })
  @IsString()
  description: string;

  @ApiProperty({
    example: '2026-09-29T08:56:00.000Z',
    description: '变动时间（ISO 字符串）',
  })
  @IsString()
  createdAt: string;
}

/**
 * 额度变动记录统计概览（后端权威计算，前端仅展示）。
 *
 * 口径与列表同源：**吃当前 Tab 过滤、不吃分页**。
 * `totalRecords` 因此恒等于响应体的 `total`（列表头「共 N 条」的事实源），
 * 避免「总记录 24 / 共 8 条」这类自相矛盾；切回「全部」Tab 即为完整分布。
 */
export class PulseAdminNewCustomerQuotaLogsStatsDto {
  @ApiProperty({ example: 24, description: '变动记录总条数' })
  @IsInt()
  totalRecords: number;

  @ApiProperty({ example: 6, description: '管理员调整次数' })
  @IsInt()
  adminAdjustCount: number;

  @ApiProperty({ example: 8, description: '充值次数（商家自付充值）' })
  @IsInt()
  rechargeCount: number;

  @ApiProperty({
    example: 10,
    description: '消耗次数（新客消耗 + 额度清零）',
  })
  @IsInt()
  consumeCount: number;
}

/** 额度变动记录分页结果（page / pageSize 真分页） */
export class PulseAdminNewCustomerQuotaLogsResponseDto {
  @ApiProperty({
    type: [PulseAdminNewCustomerQuotaLogDto],
    description: '当前页变动记录',
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PulseAdminNewCustomerQuotaLogDto)
  items: PulseAdminNewCustomerQuotaLogDto[];

  @ApiProperty({ example: 24, description: '当前 Tab 下的记录总数' })
  @IsInt()
  total: number;

  @ApiProperty({ example: 1, description: '当前页码（从 1 开始）' })
  @IsInt()
  page: number;

  @ApiProperty({ example: 20, description: '每页条数' })
  @IsInt()
  pageSize: number;

  @ApiProperty({ example: false, description: '是否还有下一页' })
  @IsBoolean()
  hasMore: boolean;

  @ApiProperty({
    type: PulseAdminNewCustomerQuotaLogsStatsDto,
    description: '统计概览（按门店全量流水计算，与 Tab 与分页无关）',
  })
  @ValidateNested()
  @Type(() => PulseAdminNewCustomerQuotaLogsStatsDto)
  stats: PulseAdminNewCustomerQuotaLogsStatsDto;
}
