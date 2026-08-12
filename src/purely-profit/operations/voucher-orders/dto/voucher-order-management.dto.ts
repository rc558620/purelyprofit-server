// 商家端团购券订单管理 DTO：列表查询 / 列表项 / 语音开关更新（全部金额单位分为后端权威）
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

/** 团购券订单状态筛选（all=全部；其余与订单状态枚举一致） */
export enum VoucherOrderStatusFilter {
  ALL = 'all',
  PENDING = 'pending',
  USED = 'used',
  REFUNDED = 'refunded',
  EXPIRED = 'expired',
}

/** 时间范围预设（与交班记录弹窗口径一致） */
export enum VoucherOrderTimePreset {
  TODAY = 'today',
  DAYS_7 = '7d',
  DAYS_30 = '30d',
}

/** 商家端团购券订单分页查询参数 */
export class QueryVoucherOrdersDto {
  @ApiPropertyOptional({
    description: '状态筛选：all/pending/used/refunded/expired，默认 all',
    enum: VoucherOrderStatusFilter,
    example: VoucherOrderStatusFilter.PENDING,
  })
  @IsOptional()
  @IsEnum(VoucherOrderStatusFilter, { message: '状态筛选不正确' })
  status?: VoucherOrderStatusFilter;

  @ApiPropertyOptional({
    description: '时间范围预设：today/7d/30d；与 date 互斥，默认 today',
    enum: VoucherOrderTimePreset,
    example: VoucherOrderTimePreset.TODAY,
  })
  @IsOptional()
  @IsEnum(VoucherOrderTimePreset, { message: '时间范围不正确' })
  preset?: VoucherOrderTimePreset;

  @ApiPropertyOptional({
    description: '指定日期，格式 YYYY-MM-DD；传入后优先按该日期过滤',
    example: '2026-08-12',
  })
  @IsOptional()
  @IsString({ message: '日期必须是字符串' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: '日期格式必须为 YYYY-MM-DD' })
  date?: string;

  @ApiPropertyOptional({ description: '分页大小，默认 20', example: 20 })
  @IsOptional()
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(100, { message: 'limit 最大为 100' })
  limit?: number;

  @ApiPropertyOptional({ description: '分页偏移，默认 0', example: 0 })
  @IsOptional()
  @IsInt({ message: 'offset 必须是整数' })
  @Min(0, { message: 'offset 最小为 0' })
  offset?: number;
}

/** 商家端团购券订单列表项 */
export class VoucherOrderListItemDto {
  /** 业务订单号 */
  @ApiProperty({ description: '业务订单号' })
  orderNo!: string;

  /** 团购券码 */
  @ApiProperty({ description: '团购券码' })
  voucherCode!: string | null;

  /** 顾客姓名快照 */
  @ApiProperty({ description: '顾客姓名' })
  guestName!: string | null;

  /** 客人电话快照 */
  @ApiProperty({ description: '客人电话' })
  guestPhone!: string | null;

  /** 商品分类名快照（如小包/中包） */
  @ApiProperty({ description: '商品分类名（团购券类型）' })
  categoryName!: string | null;

  /** 商品名称快照 */
  @ApiProperty({ description: '商品名称' })
  productName!: string;

  /** 商品图片 URL（取营销商品当前图，商品删除后为 null） */
  @ApiProperty({ description: '商品图片 URL（商品删除后为 null）' })
  productImage!: string | null;

  /** 购买数量 */
  @ApiProperty({ description: '购买数量' })
  quantity!: number;

  /** 实付金额（分，后端权威） */
  @ApiProperty({ description: '实付金额（分）' })
  paidAmountFen!: number;

  /** 订单状态：pending/used/refunded/expired */
  @ApiProperty({ description: '订单状态：pending/used/refunded/expired' })
  status!: 'pending' | 'used' | 'refunded' | 'expired';

  /** 绑定的空间会话 ID（used 且为空 = 已核销未开台，商家仍可拒绝/开台） */
  @ApiProperty({
    description: '绑定的空间会话 ID（used 且为空 = 已核销未开台）',
  })
  usedSessionId!: number | null;

  /** 下单时间 ISO */
  @ApiProperty({ description: '下单时间 ISO' })
  createdAt!: string;

  /** 确认时间 ISO（未确认为 null） */
  @ApiProperty({ description: '确认时间 ISO（未确认为 null）' })
  confirmedAt!: string | null;

  /** 用户端核销时间 ISO（用户主动核销时非空） */
  @ApiProperty({ description: '用户端核销时间 ISO（用户主动核销时非空）' })
  verifyAt!: string | null;

  /** 确认操作员姓名快照（未确认为 null） */
  @ApiProperty({ description: '确认操作员姓名（未确认为 null）' })
  confirmedByStaffName!: string | null;

  /** 拒绝时间 ISO（未拒绝为 null） */
  @ApiProperty({ description: '拒绝时间 ISO（未拒绝为 null）' })
  rejectedAt!: string | null;

  /** 退款时间 ISO（用户主动退款时非空） */
  @ApiProperty({ description: '退款时间 ISO（用户主动退款时非空）' })
  refundAt!: string | null;

  /** 拒绝操作员姓名快照（未拒绝为 null） */
  @ApiProperty({ description: '拒绝操作员姓名（未拒绝为 null）' })
  rejectedByStaffName!: string | null;
}

/** 商家端团购券订单分页列表响应 */
export class VoucherOrderListResponseDto {
  /** 列表项 */
  @ApiProperty({ type: [VoucherOrderListItemDto] })
  items!: VoucherOrderListItemDto[];

  /** 总数（同筛选条件下） */
  @ApiProperty({ description: '总数' })
  total!: number;
}

/** 更新团购券新订单语音播报开关 */
export class UpdateVoucherOrderVoiceSettingsDto {
  @ApiPropertyOptional({ description: '新订单语音播报开关（默认关闭）' })
  @IsOptional()
  @IsBoolean({ message: 'voucherOrderVoiceEnabled 必须是布尔值' })
  voucherOrderVoiceEnabled?: boolean;
}

/** 团购券新订单语音播报开关响应 */
export class VoucherOrderVoiceSettingsDto {
  /** 新订单语音播报开关 */
  @ApiProperty({ description: '新订单语音播报开关' })
  voucherOrderVoiceEnabled!: boolean;
}
