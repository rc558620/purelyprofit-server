// 客存 C 端 DTO：我的客存列表/详情、取件码与确认/拒绝，字段对齐 purelyClub/types/custody.ts
import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 会员可见的状态枚举。
 *
 * draft 仅通过 `status=draft` 的「待确认」列表与推送确认入口透出，
 * 默认列表仍由读服务剔除；void 对会员永不透出。
 */
export const CLUB_CUSTODY_STATUS_VALUES = [
  'draft',
  'stored',
  'finished',
  'expired',
] as const;

export type ClubCustodyStatus = (typeof CLUB_CUSTODY_STATUS_VALUES)[number];

/** 我的客存列表查询入参 */
export class ListClubCustodyOrdersQueryDto {
  /** 状态筛选 */
  @ApiPropertyOptional({
    description: '状态筛选',
    enum: ['all', ...CLUB_CUSTODY_STATUS_VALUES],
  })
  @IsOptional()
  @IsIn(['all', ...CLUB_CUSTODY_STATUS_VALUES], { message: 'status 不合法' })
  status?: string;

  /** 游标 */
  @ApiPropertyOptional({ description: '分页游标，首次查询不传' })
  @IsOptional()
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(64, { message: 'cursor 最长 64 个字符' })
  cursor?: string;

  /** 每页条数 */
  @ApiPropertyOptional({ description: '每页条数，默认 10，最大 50' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最少为 1' })
  @Max(50, { message: 'limit 最大为 50' })
  limit?: number;
}

/** 我的客存单（会员视角） */
export class ClubCustodyOrderDto {
  /** 存单主键 */
  @ApiProperty({ description: '存单主键' })
  id!: string;

  /** 门店 ID */
  @ApiProperty({ description: '门店 ID' })
  storeId!: number;

  /** 门店名称 */
  @ApiProperty({ description: '门店名称' })
  storeName!: string;

  /** 商品名称 */
  @ApiProperty({ description: '商品名称' })
  productName!: string;

  /** 规格名称 */
  @ApiProperty({ description: '规格名称' })
  specName!: string;

  /** 计量单位快照 */
  @ApiProperty({ description: '计量单位' })
  unit!: string;

  /** 存入总量 */
  @ApiProperty({ description: '存入总量（整数）' })
  totalQty!: number;

  /** 剩余可取数量 */
  @ApiProperty({ description: '剩余可取数量（整数）' })
  remainingQty!: number;

  /** 存放位置 */
  @ApiProperty({ description: '存放位置' })
  location!: string;

  /** 存入时间（ISO 字符串） */
  @ApiProperty({ description: '存入时间（ISO 字符串）' })
  storedAt!: string;

  /** 到期时间（ISO 字符串，空串表示长期有效） */
  @ApiProperty({ description: '到期时间（ISO 字符串），空串表示长期有效' })
  expireAt!: string;

  /** 存单状态 */
  @ApiProperty({ description: '存单状态', enum: CLUB_CUSTODY_STATUS_VALUES })
  status!: ClubCustodyStatus;

  /** 备注 */
  @ApiProperty({ description: '备注' })
  remark!: string;

  /** 物品图片 URL（存入时快照），无图为空串（会员端据此回落占位图标） */
  @ApiProperty({ description: '物品图片 URL，无图为空串' })
  image!: string;
}

/** 取出流水（会员视角） */
export class ClubCustodyPickupRecordDto {
  /** 流水主键 */
  @ApiProperty({ description: '流水主键' })
  id!: string;

  /** 所属存单主键 */
  @ApiProperty({ description: '所属存单主键' })
  custodyOrderId!: string;

  /** 本次取出数量 */
  @ApiProperty({ description: '本次取出数量（整数）' })
  qty!: number;

  /** 取出时间（ISO 字符串） */
  @ApiProperty({ description: '取出时间（ISO 字符串）' })
  pickedAt!: string;

  /** 核销门店名称 */
  @ApiProperty({ description: '核销门店名称' })
  storeName!: string;
}

/** 我的客存汇总（后端聚合，前端不做计算） */
export class ClubCustodySummaryDto {
  /** 在存单量 */
  @ApiProperty({ description: '在存单量' })
  storedCount!: number;

  /** 已取件数（历史取出数量合计） */
  @ApiProperty({ description: '已取件数（历史取出数量合计）' })
  pickedCount!: number;

  /** 临近过期单量 */
  @ApiProperty({ description: '临近过期单量' })
  expiringCount!: number;

  /**
   * 待确认（草稿）单量。
   * 与 items 里的 draft 预览不同：列表预览只取前几笔，徽标必须反映真实总数，
   * 否则会员有 5 笔待确认却只看到「3」，会以为剩下的单子丢了。
   */
  @ApiProperty({ description: '待确认（草稿）单量' })
  pendingCount!: number;
}

/** 我的客存列表响应 */
export class ClubCustodyOrderListResponseDto {
  /** 当前页存单 */
  @ApiProperty({ type: [ClubCustodyOrderDto] })
  items!: ClubCustodyOrderDto[];

  /** 下一页游标，null 表示已到末页 */
  @ApiPropertyOptional({ description: '下一页游标，null 表示没有更多数据' })
  nextCursor!: string | null;

  /** 汇总 */
  @ApiProperty({ type: ClubCustodySummaryDto })
  summary!: ClubCustodySummaryDto;
}

/** 我的客存详情响应 */
export class ClubCustodyOrderDetailResponseDto {
  /** 存单详情 */
  @ApiProperty({ type: ClubCustodyOrderDto })
  order!: ClubCustodyOrderDto;

  /** 取出流水（时间倒序） */
  @ApiProperty({ type: [ClubCustodyPickupRecordDto] })
  pickupRecords!: ClubCustodyPickupRecordDto[];
}

/** 确认 / 拒绝后的存单回包 */
export class ClubCustodyOrderResponseDto {
  /** 变更后存单 */
  @ApiProperty({ type: ClubCustodyOrderDto })
  order!: ClubCustodyOrderDto;
}

/** 取件码响应 */
export class ClubCustodyPickupCodeDto {
  /** 6 位取件码 */
  @ApiProperty({ description: '6 位取件码', example: '824163' })
  code!: string;

  /** 过期时间戳（毫秒，便于小程序端倒计时） */
  @ApiProperty({ description: '过期时间戳（毫秒）' })
  expiresAt!: number;

  /** 签发时的剩余可取数量 */
  @ApiProperty({ description: '签发时的剩余可取数量' })
  qty!: number;
}

/** 通用空响应（拒绝 / 取消取件码） */
export class ClubCustodyAckResponseDto {
  /** 是否成功 */
  @ApiProperty({ description: '操作是否成功' })
  success!: boolean;
}
