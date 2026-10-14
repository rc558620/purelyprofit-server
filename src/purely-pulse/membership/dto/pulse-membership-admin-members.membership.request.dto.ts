// Pulse / 管理端会员成交请求 DTO
//
// 三个接口共用「一次成交」的口径：设置会员等级（落库）、成交价预览（只算不落库）、
// 子账号加价补录（只动子账号字段）。成交总额 priceDisplay 与子账号加价
// subAccountAmountDisplay 都在这里，改口径时一处就能改全。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import { SUB_ACCOUNT_PRICING_PLAN_IDS } from '../../../purely-profit/member/platform-membership/platform-membership.constants';
import { trimString } from './pulse-membership-admin-logs.shared.dto';
import { PulseAdminMemberSubAccountDealFieldsDto } from './pulse-membership-admin-members.base.dto';
import {
  PULSE_AMOUNT_NON_NEGATIVE_PATTERN,
  PULSE_AMOUNT_POSITIVE_PATTERN,
  PULSE_MEMBER_LEVEL_VALUES,
} from './pulse-membership-admin-members.constants';
import {
  toNullableNumber,
  toOptionalAmountString,
  toOptionalBoolean,
  toOptionalInt,
} from './pulse-membership-admin-members.transform';
import type {
  PulseMemberLevelValue,
  PulseMembershipPlanId,
} from '../membership.types';

/** 设置会员等级 —— 一次显式成交，会覆盖该档位成交价 */
export class PulseAdminMemberMembershipDto extends PulseAdminMemberSubAccountDealFieldsDto {
  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '目标会员等级',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '兼容旧请求的会员等级字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  memberLevel?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '兼容旧请求的会员等级字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  membershipLevel?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '会员到期时间戳（ms）',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  membershipExpiry?: number | null;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '兼容旧请求的到期时间字段',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  expireAt?: number | null;

  @ApiPropertyOptional({
    example: 1747209600000,
    description: '兼容旧请求的到期时间字段',
  })
  @IsOptional()
  @Transform(({ value }) => toNullableNumber(value))
  @IsInt({ message: '会员到期时间必须是整数时间戳' })
  expiryAt?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '显式确认将当前生效会员降级为免费会员',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '降级确认标记必须是布尔值' })
  confirmDowngradeToFree?: boolean;

  @ApiPropertyOptional({
    example: true,
    description:
      '显式确认把会员**降级到更低的付费档位**（如年度 → 月度）。' +
      '不传时系统会保持当前档位、只按所选档位追加时长，避免误降档；' +
      '对开了子账号的门店，降档后会员却买不回去，会直接卡死续费。',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '降档确认标记必须是布尔值' })
  confirmDowngradePlan?: boolean;

  @ApiPropertyOptional({
    example: '598',
    description:
      '本次成交价展示值（元字符串，即成交总额）。管理端设置会员等级视为一次' +
      '显式成交，会**覆盖**该档位已有的成交价；免费会员忽略该字段',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '成交价必须是字符串' })
  @Matches(PULSE_AMOUNT_POSITIVE_PATTERN, {
    message: '成交价必须是正数，最多两位小数',
  })
  priceDisplay?: string;

  @ApiPropertyOptional({
    example: '250',
    description:
      '本次成交的子账号加价展示值（元字符串，0~2 位小数）。参与续费定价：' +
      '标准总价 = 当前配置价 + 本字段',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '子账号加价必须是字符串' })
  @Matches(PULSE_AMOUNT_NON_NEGATIVE_PATTERN, {
    message: '子账号加价必须是正数，最多两位小数',
  })
  subAccountAmountDisplay?: string;

  @ApiPropertyOptional({
    example: 2,
    description:
      '本次设置的期数（弹窗的 × 1 / × 2 / × 3 / × 6 / × 12）。' +
      '追加时长与新客额度都按它叠加：年度 × 2 = 730 天、300 × 2 = 600 位新客。' +
      '不传按 1 期处理；永久会员固定 1 期',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalInt(value))
  @IsInt({ message: '期数必须是整数' })
  @Min(1, { message: '期数不能小于 1' })
  @Max(12, { message: '期数不能超过 12' })
  multiplier?: number;

  @ApiPropertyOptional({
    example: true,
    description:
      '本次设置是否计入收入，与是否降档无关（被「只升不降」抬回原档位、' +
      '只追加时长时同样有效）。勾选 → 按所选档位计入平台营收（订单渠道 admin），' +
      '金额取成交价、未填则回落所选档位配置价；' +
      '不勾选 → 按赠送处理，金额落 0 且不计入营收（订单渠道 gift），' +
      '仅在「设置会员等级记录」里标注「赠送」',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '计入收入标记必须是布尔值' })
  countAsIncome?: boolean;

  @ApiPropertyOptional({
    example: 'member-detail-membership-modal',
    description: '前端调用来源标识，便于排查会员等级变更入口',
  })
  @IsOptional()
  @IsString({ message: '调用来源标识必须是字符串' })
  actionSource?: string;
}

/**
 * POST /pulse/membership/admin/members/:id/membership/pricing-preview
 * 会员成交价预览 —— 只算不落库
 */
export class PulseAdminMemberPricingPreviewDto extends PulseAdminMemberSubAccountDealFieldsDto {
  @ApiPropertyOptional({
    enum: PULSE_MEMBER_LEVEL_VALUES,
    description: '目标会员等级；不传或 free 表示免费会员（没有定价）',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_LEVEL_VALUES, { message: '会员等级不合法' })
  level?: PulseMemberLevelValue;

  @ApiPropertyOptional({
    example: '650',
    description: '本次成交价展示值（元字符串）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '成交价必须是字符串' })
  @Matches(PULSE_AMOUNT_POSITIVE_PATTERN, {
    message: '成交价必须是正数，最多两位小数',
  })
  priceDisplay?: string;

  @ApiPropertyOptional({
    example: '150',
    description: '本次成交的子账号加价展示值（元字符串）',
  })
  @IsOptional()
  @Transform(({ value }) => trimString(value))
  @IsString({ message: '子账号加价必须是字符串' })
  @Matches(PULSE_AMOUNT_NON_NEGATIVE_PATTERN, {
    message: '子账号加价必须是正数，最多两位小数',
  })
  subAccountAmountDisplay?: string;
}

/**
 * PATCH /pulse/membership/admin/members/:id/deal-price/sub-account
 * 补录 / 撤销存量门店的子账号加价 —— 只动子账号字段，不改写成交总额
 */
export class PulseAdminMemberSubAccountAmountBackfillDto extends PulseAdminMemberSubAccountDealFieldsDto {
  @ApiProperty({
    enum: SUB_ACCOUNT_PRICING_PLAN_IDS,
    description:
      '目标档位：哪张成交记录要补录。仅年度 / 永久 —— 月 / 季开不了子账号，无需补录',
  })
  @IsIn([...SUB_ACCOUNT_PRICING_PLAN_IDS], {
    message: '仅年度 / 永久档位支持补录子账号加价',
  })
  planId: PulseMembershipPlanId;

  @ApiPropertyOptional({
    example: '150',
    description:
      '子账号加价展示值（元字符串）。不传或传空串表示撤销补录，回退到旧口径',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalAmountString(value))
  @IsString({ message: '子账号加价必须是字符串' })
  @Matches(PULSE_AMOUNT_NON_NEGATIVE_PATTERN, {
    message: '子账号加价必须是正数，最多两位小数',
  })
  subAccountAmountDisplay?: string;
}
