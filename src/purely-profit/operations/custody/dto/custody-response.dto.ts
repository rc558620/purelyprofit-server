// 客存 B 端出参 DTO：存单、取出流水、核销预览与统计，字段与前端 custodyManagement.types 对齐
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import type {
  CustodyOperatorRole,
  CustodyStatusValue,
  CustodyStockModeValue,
} from '../custody.domain';

/** 客存单（门店视角） */
export class CustodyOrderResponseDto {
  /** 存单主键 */
  @ApiProperty({ description: '存单主键', example: '128' })
  @IsString({ message: '存单主键必须是字符串' })
  id!: string;

  /** 存单号 */
  @ApiProperty({ description: '存单号', example: 'CO2026093050001' })
  @IsString({ message: '存单号必须是字符串' })
  orderNo!: string;

  /** 会员姓名快照 */
  @ApiProperty({ description: '会员姓名' })
  @IsString({ message: '会员姓名必须是字符串' })
  memberName!: string;

  /** 会员手机号（展示层自行脱敏） */
  @ApiProperty({ description: '会员手机号' })
  @IsString({ message: '会员手机号必须是字符串' })
  phone!: string;

  /** 商品名称 */
  @ApiProperty({ description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  productName!: string;

  /** 规格名称 */
  @ApiProperty({ description: '规格名称' })
  @IsString({ message: '规格名称必须是字符串' })
  specName!: string;

  /** 计量单位快照 */
  @ApiProperty({ description: '计量单位' })
  @IsString({ message: '计量单位必须是字符串' })
  unit!: string;

  /** 存入总量 */
  @ApiProperty({ description: '存入总量（整数）' })
  @IsInt({ message: '存入总量必须是整数' })
  totalQty!: number;

  /** 剩余可取数量 */
  @ApiProperty({ description: '剩余可取数量（整数）' })
  @IsInt({ message: '剩余可取数量必须是整数' })
  remainingQty!: number;

  /** 存放位置 */
  @ApiProperty({ description: '存放位置' })
  @IsString({ message: '存放位置必须是字符串' })
  location!: string;

  /** 存入时间（ISO 字符串） */
  @ApiProperty({ description: '存入时间（ISO 字符串）' })
  @IsString({ message: '存入时间格式不合法' })
  storedAt!: string;

  /** 到期时间（ISO 字符串，空串表示长期有效） */
  @ApiProperty({ description: '到期时间（ISO 字符串），空串表示长期有效' })
  @IsString({ message: '到期时间格式不合法' })
  expireAt!: string;

  /** 存单状态（expired=已到期，由后端按到期时间惰性派生） */
  @ApiProperty({
    description:
      '存单状态：draft=待确认 stored=在存 finished=已取完 expired=已到期 void=已作废',
    enum: ['draft', 'stored', 'finished', 'expired', 'void'],
  })
  @IsString({ message: '存单状态必须是字符串' })
  status!: CustodyStatusValue;

  /**
   * 是否临期：在存且剩余有效期 ≤ CUSTODY_EXPIRING_SOON_DAYS 天。
   * 阈值属业务规则，由后端统一判定，前端只负责配色与文案，避免两端各维护一份常量。
   */
  @ApiProperty({ description: '是否临期（在存且剩余有效期 ≤ 3 天）' })
  @IsBoolean({ message: '是否临期必须是布尔值' })
  expiringSoon!: boolean;

  /** 库存口径快照 */
  @ApiProperty({ description: '库存口径', enum: ['sold', 'frozen'] })
  @IsString({ message: '库存口径必须是字符串' })
  stockMode!: CustodyStockModeValue;

  /** 存入经手店员姓名快照 */
  @ApiProperty({ description: '存入经手店员' })
  @IsString({ message: '存入经手店员必须是字符串' })
  createdByName!: string;

  /**
   * 存入经手角色：owner=主账号 manager=店长 staff=操作员。
   * 由后端按店员档案解析，店员已删除时兜底为 staff。
   */
  @ApiProperty({
    description: '存入经手角色',
    enum: ['owner', 'manager', 'staff'],
  })
  @IsString({ message: '存入经手角色必须是字符串' })
  createdByRole!: CustodyOperatorRole;

  /** 作废原因（仅作废单有值） */
  @ApiPropertyOptional({ description: '作废原因' })
  @IsOptional()
  @IsString({ message: '作废原因必须是字符串' })
  voidReason!: string;

  /** 备注 */
  @ApiProperty({ description: '备注' })
  @IsString({ message: '备注必须是字符串' })
  remark!: string;

  /** 物品图片 URL（存入时快照），无图为空串 */
  @ApiProperty({ description: '物品图片 URL，无图为空串' })
  @IsString({ message: '物品图片必须是字符串' })
  image!: string;
}

/** 取出流水 */
export class CustodyPickupRecordDto {
  /** 流水主键 */
  @ApiProperty({ description: '流水主键' })
  @IsString({ message: '流水主键必须是字符串' })
  id!: string;

  /** 本次取出数量 */
  @ApiProperty({ description: '本次取出数量（整数）' })
  @IsInt({ message: '取出数量必须是整数' })
  qty!: number;

  /** 取出时间（ISO 字符串） */
  @ApiProperty({ description: '取出时间（ISO 字符串）' })
  @IsString({ message: '取出时间格式不合法' })
  pickedAt!: string;

  /** 核销店员姓名快照 */
  @ApiProperty({ description: '核销店员' })
  @IsString({ message: '核销店员必须是字符串' })
  operatorName!: string;

  /**
   * 核销店员角色：owner=主账号 manager=店长 staff=操作员。
   * 由后端按店员档案解析，店员已删除时兜底为 staff。
   */
  @ApiProperty({
    description: '核销店员角色',
    enum: ['owner', 'manager', 'staff'],
  })
  @IsString({ message: '核销店员角色必须是字符串' })
  operatorRole!: CustodyOperatorRole;
}

/** 客存统计（后端聚合，前端不做任何计算） */
export class CustodyStatsDto {
  /** 在存单量 */
  @ApiProperty({ description: '在存单量' })
  @IsInt({ message: '在存单量必须是整数' })
  storedCount!: number;

  /** 在存件数（剩余数量合计） */
  @ApiProperty({ description: '在存件数（剩余数量合计）' })
  @IsInt({ message: '在存件数必须是整数' })
  storedQty!: number;

  /** 临近过期单量 */
  @ApiProperty({ description: '临近过期单量' })
  @IsInt({ message: '临近过期单量必须是整数' })
  expiringCount!: number;

  /** 本月取出次数 */
  @ApiProperty({ description: '本月取出次数' })
  @IsInt({ message: '本月取出次数必须是整数' })
  monthPickupCount!: number;
}

/** 客存列表响应 */
export class CustodyOrderListResponseDto {
  /** 当前页存单 */
  @ApiProperty({ type: [CustodyOrderResponseDto] })
  @IsArray({ message: '存单列表必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CustodyOrderResponseDto)
  items!: CustodyOrderResponseDto[];

  /** 下一页游标，null 表示已到末页 */
  @ApiPropertyOptional({ description: '下一页游标，null 表示没有更多数据' })
  @IsOptional()
  @IsString({ message: '游标必须是字符串' })
  nextCursor!: string | null;

  /** 符合筛选条件的总条数 */
  @ApiProperty({ description: '符合筛选条件的总条数' })
  @IsInt({ message: '总条数必须是整数' })
  total!: number;

  /** 统计口径 */
  @ApiProperty({ type: CustodyStatsDto })
  @ValidateNested()
  @Type(() => CustodyStatsDto)
  summary!: CustodyStatsDto;
}

/** 客存详情响应 */
export class CustodyOrderDetailResponseDto {
  /** 存单详情 */
  @ApiProperty({ type: CustodyOrderResponseDto })
  @ValidateNested()
  @Type(() => CustodyOrderResponseDto)
  order!: CustodyOrderResponseDto;

  /** 取出流水（时间倒序） */
  @ApiProperty({ type: [CustodyPickupRecordDto] })
  @IsArray({ message: '取出流水必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => CustodyPickupRecordDto)
  pickupRecords!: CustodyPickupRecordDto[];
}

/** 发起存入响应 */
export class CreateCustodyOrderResponseDto {
  /** 新建立的存单 */
  @ApiProperty({ type: CustodyOrderResponseDto })
  @ValidateNested()
  @Type(() => CustodyOrderResponseDto)
  order!: CustodyOrderResponseDto;

  /** 是否需要客户确认（门店关闭确认时存单直接进入在存） */
  @ApiProperty({ description: '是否需要客户在小程序确认' })
  @IsBoolean({ message: '是否需要客户确认必须是布尔值' })
  requireMemberConfirm!: boolean;
}

/** 核销预览：店员输入取件码后展示的待核销内容 */
export class VerifyPickupPreviewDto {
  /** 存单主键 */
  @ApiProperty({ description: '存单主键' })
  @IsString({ message: '存单主键必须是字符串' })
  id!: string;

  /** 存单号 */
  @ApiProperty({ description: '存单号' })
  @IsString({ message: '存单号必须是字符串' })
  orderNo!: string;

  /** 会员姓名 */
  @ApiProperty({ description: '会员姓名' })
  @IsString({ message: '会员姓名必须是字符串' })
  memberName!: string;

  /** 手机号（已脱敏） */
  @ApiProperty({ description: '脱敏手机号', example: '138****8000' })
  @IsString({ message: '脱敏手机号必须是字符串' })
  phoneMasked!: string;

  /** 商品名称 */
  @ApiProperty({ description: '商品名称' })
  @IsString({ message: '商品名称必须是字符串' })
  productName!: string;

  /** 规格名称 */
  @ApiProperty({ description: '规格名称' })
  @IsString({ message: '规格名称必须是字符串' })
  specName!: string;

  /** 计量单位 */
  @ApiProperty({ description: '计量单位' })
  @IsString({ message: '计量单位必须是字符串' })
  unit!: string;

  /** 剩余可取数量 */
  @ApiProperty({ description: '剩余可取数量' })
  @IsInt({ message: '剩余可取数量必须是整数' })
  remainingQty!: number;

  /** 存放位置 */
  @ApiProperty({ description: '存放位置' })
  @IsString({ message: '存放位置必须是字符串' })
  location!: string;

  /** 核销令牌：确认取出阶段回传 */
  @ApiProperty({ description: '核销令牌，确认取出时回传' })
  @IsString({ message: '核销令牌必须是字符串' })
  verifyToken!: string;
}

/** 校验取件码响应 */
export class VerifyPickupCodeResponseDto {
  /** 待核销预览 */
  @ApiProperty({ type: VerifyPickupPreviewDto })
  @ValidateNested()
  @Type(() => VerifyPickupPreviewDto)
  preview!: VerifyPickupPreviewDto;

  /**
   * 本次核销是否必须核对会员手机号后四位。
   *
   * 门店开关开启或商品单价达阈值时为 true，前端据此决定是否展示后四位输入框；
   * 判定与确认取出阶段的强制比对共用 CustodyPickupVerifyService 的同一口径。
   */
  @ApiProperty({ description: '是否需要核对会员手机号后四位' })
  @IsBoolean({ message: '是否需要手机号核验必须是布尔值' })
  phoneVerifyRequired!: boolean;

  /** 触发原因（门店强制核验 / 单价达阈值），未触发为 null；仅供前端提示文案使用 */
  @ApiPropertyOptional({
    description: '核验触发原因：门店强制核验 / 单价达阈值，未触发为 null',
    nullable: true,
    type: String,
  })
  @IsOptional()
  @IsString({ message: '核验触发原因必须是字符串' })
  phoneVerifyReason?: string | null;
}

/** 校验会员响应：存入前按手机号回显会员信息 */
export class VerifyCustodyMemberResponseDto {
  /** 会员主键 */
  @ApiProperty({ description: '会员主键' })
  @IsInt({ message: '会员主键必须是整数' })
  memberId!: number;

  /** 会员昵称（姓名为空时回落手机号） */
  @ApiProperty({ description: '会员昵称' })
  @IsString({ message: '会员昵称必须是字符串' })
  memberName!: string;

  /** 手机号（已脱敏） */
  @ApiProperty({ description: '脱敏手机号', example: '138****8000' })
  @IsString({ message: '脱敏手机号必须是字符串' })
  phoneMasked!: string;
}

/** 作废 / 取出后的存单回包 */
export class CustodyOrderActionResponseDto {
  /** 变更后存单 */
  @ApiProperty({ type: CustodyOrderResponseDto })
  @ValidateNested()
  @Type(() => CustodyOrderResponseDto)
  order!: CustodyOrderResponseDto;
}

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
