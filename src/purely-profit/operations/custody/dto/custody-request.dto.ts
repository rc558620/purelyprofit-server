// 客存 B 端入参 DTO：发起存入、列表筛选、核销与门店配置，统一承担校验与 Swagger 说明
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { CUSTODY_MAX_LIMIT, CUSTODY_MAX_QTY } from '../custody.constants';

/** 手机号格式（中国大陆 11 位） */
const PHONE_PATTERN = /^1[3-9]\d{9}$/;

/** 6 位数字短码 */
const SHORT_CODE_PATTERN = /^\d{6}$/;

/** 手机号后四位 */
const PHONE_SUFFIX_PATTERN = /^\d{4}$/;

/** 发起存入请求体 */
export class CreateCustodyOrderDto {
  /** 会员手机号：用于在当前门店定位会员档案（一期强制会员） */
  @ApiProperty({ description: '会员手机号', example: '13800138000' })
  @IsString({ message: '会员手机号必须是字符串' })
  @Matches(PHONE_PATTERN, { message: '会员手机号格式不正确' })
  memberPhone!: string;

  /** 商品名（可由前端自由录入，不强制关联商品档案） */
  @ApiProperty({ description: '商品名称', example: '山崎 12 年' })
  @IsString({ message: '商品名称必须是字符串' })
  @Length(1, 100, { message: '商品名称长度需在 1 到 100 之间' })
  productName!: string;

  /** 商品 ID（可空，用于冻结库存口径） */
  @ApiPropertyOptional({ description: '商品 ID，冻结库存口径下建议传入' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '商品 ID 必须是整数' })
  @Min(1, { message: '商品 ID 不合法' })
  productId?: number;

  /** 规格名快照 */
  @ApiPropertyOptional({ description: '规格名称', example: '整瓶' })
  @IsOptional()
  @IsString({ message: '规格名称必须是字符串' })
  @MaxLength(50, { message: '规格名称最长 50 个字符' })
  specName?: string;

  /** 计量单位快照 */
  @ApiProperty({ description: '计量单位', example: '瓶' })
  @IsString({ message: '计量单位必须是字符串' })
  @Length(1, 10, { message: '计量单位长度需在 1 到 10 之间' })
  unit!: string;

  /** 存入总量（整数） */
  @ApiProperty({ description: '存入数量（整数）', example: 2 })
  @Type(() => Number)
  @IsInt({ message: '存入数量必须是整数' })
  @Min(1, { message: '存入数量至少为 1' })
  @Max(CUSTODY_MAX_QTY, { message: `存入数量最多为 ${CUSTODY_MAX_QTY}` })
  totalQty!: number;

  /** 存放位置 */
  @ApiPropertyOptional({ description: '存放位置', example: '酒柜 A-12' })
  @IsOptional()
  @IsString({ message: '存放位置必须是字符串' })
  @MaxLength(50, { message: '存放位置最长 50 个字符' })
  location?: string;

  /** 到期时间（ISO 字符串，不传时按门店默认有效期计算） */
  @ApiPropertyOptional({
    description: '到期时间（ISO 字符串），不传表示长期有效',
  })
  @IsOptional()
  @IsString({ message: '到期时间格式不合法' })
  expireAt?: string;

  /** 库存口径：不传时按门店配置 */
  @ApiPropertyOptional({
    description: '库存口径：sold=实物已售出（不占库存）frozen=冻结库存',
    enum: ['sold', 'frozen'],
  })
  @IsOptional()
  @IsIn(['sold', 'frozen'], { message: '库存口径不合法' })
  stockMode?: string;

  /** 来源销售单 ID：sold 口径下证明已收款 */
  @ApiPropertyOptional({ description: '来源销售单 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '来源销售单 ID 必须是整数' })
  @Min(1, { message: '来源销售单 ID 不合法' })
  sourceOrderId?: number;

  /** 备注 */
  @ApiPropertyOptional({ description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;

  /** 幂等键：前端生成，重复提交返回原单 */
  @ApiPropertyOptional({ description: '幂等键（前端生成），重复提交返回原单' })
  @IsOptional()
  @IsString({ message: '幂等键必须是字符串' })
  @MaxLength(64, { message: '幂等键最长 64 个字符' })
  idempotencyKey?: string;
}

/** 列表查询入参 */
export class ListCustodyOrdersQueryDto {
  /** 状态筛选 */
  @ApiPropertyOptional({
    description: '状态筛选',
    enum: ['all', 'draft', 'stored', 'finished', 'expired', 'void'],
  })
  @IsOptional()
  @IsIn(['all', 'draft', 'stored', 'finished', 'expired', 'void'], {
    message: 'status 不合法',
  })
  status?: string;

  /** 关键字：会员姓名 / 手机号 / 商品名 / 存放位置 */
  @ApiPropertyOptional({
    description: '关键字搜索（会员姓名/手机号/商品名/存放位置）',
  })
  @IsOptional()
  @IsString({ message: 'keyword 必须是字符串' })
  @MaxLength(30, { message: 'keyword 最长 30 个字符' })
  keyword?: string;

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
  @Max(CUSTODY_MAX_LIMIT, { message: `limit 最大为 ${CUSTODY_MAX_LIMIT}` })
  limit?: number;
}

/** 校验取件码请求体 */
export class VerifyPickupCodeDto {
  /** 客户出示的 6 位取件码 */
  @ApiProperty({ description: '客户出示的 6 位取件码', example: '824163' })
  @IsString({ message: '取件码必须是字符串' })
  @Matches(SHORT_CODE_PATTERN, { message: '取件码必须是 6 位数字' })
  code!: string;
}

/** 确认取出请求体 */
export class ConfirmPickupDto {
  /** 校验阶段签发的预留令牌 */
  @ApiProperty({ description: '校验取件码后下发的核销令牌' })
  @IsString({ message: '核销令牌必须是字符串' })
  @Length(16, 128, { message: '核销令牌不合法' })
  verifyToken!: string;

  /** 本次取出数量（整数） */
  @ApiProperty({ description: '本次取出数量（整数）', example: 1 })
  @Type(() => Number)
  @IsInt({ message: '取出数量必须是整数' })
  @Min(1, { message: '取出数量至少为 1' })
  @Max(CUSTODY_MAX_QTY, { message: `取出数量最多为 ${CUSTODY_MAX_QTY}` })
  qty!: number;

  /** 幂等键：同一笔核销重复提交只扣减一次 */
  @ApiPropertyOptional({ description: '幂等键（前端生成），防止重复核销' })
  @IsOptional()
  @IsString({ message: '幂等键必须是字符串' })
  @MaxLength(64, { message: '幂等键最长 64 个字符' })
  idempotencyKey?: string;

  /** 关联消费单 ID */
  @ApiPropertyOptional({ description: '取出时所在消费单 ID' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '关联消费单 ID 必须是整数' })
  @Min(1, { message: '关联消费单 ID 不合法' })
  relatedOrderId?: number;

  /**
   * 店员已核对取件人身份（姓名 + 手机号后四位）。
   *
   * 刻意不加 @Type(() => Boolean)：字符串 "false" 会被转成 true，
   * 这里必须是真实布尔值，且后端只接受 true（P0 防冒领）。
   */
  @ApiProperty({
    description: '是否已核对取件人身份（必须为 true）',
    example: true,
  })
  @IsBoolean({ message: 'identityChecked 必须是布尔值' })
  identityChecked!: boolean;

  /** 会员手机号后四位：门店开启核验或单价达阈值时必填 */
  @ApiPropertyOptional({
    description: '会员手机号后四位（门店开启核验时必填）',
    example: '8000',
  })
  @IsOptional()
  @IsString({ message: '手机号后四位必须是字符串' })
  @Matches(PHONE_SUFFIX_PATTERN, { message: '手机号后四位必须是 4 位数字' })
  phoneSuffix?: string;
}

/** 作废存单请求体 */
export class VoidCustodyOrderDto {
  /** 作废原因（必填，最长 100 字符） */
  @ApiProperty({ description: '作废原因', example: '客户主动放弃' })
  @IsString({ message: '作废原因必须是字符串' })
  @Length(1, 100, { message: '作废原因长度需在 1 到 100 之间' })
  reason!: string;
}

/** 更新门店客存配置请求体 */
export class UpdateCustodySettingsDto {
  /** 是否启用客存 */
  @ApiPropertyOptional({ description: '是否启用客存' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled?: boolean;

  /** 库存口径 */
  @ApiPropertyOptional({
    description: '库存口径：sold=实物已售出（不占库存）frozen=冻结库存',
    enum: ['sold', 'frozen'],
  })
  @IsOptional()
  @IsIn(['sold', 'frozen'], { message: '库存口径不合法' })
  stockMode?: string;

  /** 默认有效期天数，null 表示长期有效 */
  @ApiPropertyOptional({ description: '默认有效期天数，null 表示长期有效' })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '默认有效期天数必须是整数' })
  @Min(1, { message: '默认有效期天数至少为 1' })
  @Max(3650, { message: '默认有效期天数最多为 3650' })
  defaultExpireDays?: number | null;

  /** 是否需要客户确认存入 */
  @ApiPropertyOptional({ description: '是否需要客户在小程序确认存入' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'requireMemberConfirm 必须是布尔值' })
  requireMemberConfirm?: boolean;

  /** 可选计量单位列表 */
  @ApiPropertyOptional({
    description: '可选计量单位列表',
    example: ['瓶', '杯'],
  })
  @IsOptional()
  @IsArray({ message: '单位选项必须是数组' })
  @IsString({ each: true, message: '单位选项必须是字符串' })
  @ArrayMaxSize(20, { message: '单位选项最多 20 个' })
  unitOptions?: string[];

  /** 取出核验开关：开启后核销必须再核对会员手机号后四位 */
  @ApiPropertyOptional({ description: '取出时是否强制核对手机号后四位' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean({ message: 'pickupPhoneVerifyEnabled 必须是布尔值' })
  pickupPhoneVerifyEnabled?: boolean;

  /** 单价阈值（单位：分），null 表示不按阈值触发 */
  @ApiPropertyOptional({
    description:
      '商品单价阈值（单位：分），单价达到该值即强制核验，null 关闭阈值',
    example: 50000,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: '单价阈值必须是整数（单位：分）' })
  @Min(1, { message: '单价阈值至少为 1 分' })
  @Max(99999999, { message: '单价阈值过大' })
  pickupPhoneVerifyThreshold?: number | null;
}
