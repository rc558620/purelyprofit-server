import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { SUB_ACCOUNT_PRICING_PLAN_IDS } from '../../../purely-profit/member/platform-membership/platform-membership.constants';
import type { PulseMembershipPlanId } from '../membership.types';
import {
  PULSE_MEMBER_FILTER_EXPIRY_VALUES,
  PULSE_MEMBER_FILTER_LEVEL_VALUES,
  PULSE_MEMBER_FILTER_STATUS_VALUES,
  PULSE_MEMBER_LEVEL_VALUES,
  PULSE_MEMBER_STATUS_VALUES,
  PULSE_SUB_ACCOUNT_ROLE_VALUES,
  PULSE_SUB_ACCOUNT_STATUS_VALUES,
  toNullableNumber,
  toOptionalBoolean,
} from './pulse-membership-admin-members.shared.dto';
import type {
  PulseMemberFilterExpiryValue,
  PulseMemberFilterLevelValue,
  PulseMemberFilterStatusValue,
  PulseMemberLevelValue,
  PulseMemberStatusValue,
  PulseSubAccountRoleValue,
  PulseSubAccountStatusValue,
} from './pulse-membership-admin-members.shared.dto';

/**
 * 成交价：最多两位小数的**正数**，`0` / `0.0` / `0.00` 一律拒绝。
 *
 * 放行 0 会在服务端被当成「未填价」回落到**配置价**（`resolvePriceFen('0')` 返回 null），
 * 勾了「计入收入」就等于按全价记一笔营收——运营明明没收钱。
 */
const POSITIVE_AMOUNT_PATTERN = /^(?!0+(?:\.0{1,2})?$)\d+(\.\d{1,2})?$/;

export class PulseAdminMemberMembershipDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '成交价必须是字符串' })
  @Matches(POSITIVE_AMOUNT_PATTERN, {
    message: '成交价必须是正数，最多两位小数',
  })
  priceDisplay?: string;

  @ApiPropertyOptional({
    example: 5,
    description:
      '本次成交包含的子账号数量，范围 0~10。与 subAccountAmountDisplay 成对 ' +
      '记录，用于「包含 N 个子账号」的展示与财务核算',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberMembershipDto) => dto.subAccountCount !== undefined,
  )
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '子账号数量必须是整数' })
  @Min(0, { message: '子账号数量不能小于 0' })
  @Max(10, { message: '子账号数量不能超过 10' })
  subAccountCount?: number;

  @ApiPropertyOptional({
    example: '250',
    description:
      '本次成交的子账号加价展示值（元字符串，0~2 位小数）。参与续费定价：' +
      '标准总价 = 当前配置价 + 本字段',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '子账号加价必须是字符串' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
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
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
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
export class PulseAdminMemberPricingPreviewDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

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
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '成交价必须是字符串' })
  @Matches(POSITIVE_AMOUNT_PATTERN, {
    message: '成交价必须是正数，最多两位小数',
  })
  priceDisplay?: string;

  @ApiPropertyOptional({
    example: 3,
    description: '本次成交包含的子账号数量，范围 0~10',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberPricingPreviewDto) =>
      dto.subAccountCount !== undefined,
  )
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '子账号数量必须是整数' })
  @Min(0, { message: '子账号数量不能小于 0' })
  @Max(10, { message: '子账号数量不能超过 10' })
  subAccountCount?: number;

  @ApiPropertyOptional({
    example: '150',
    description: '本次成交的子账号加价展示值（元字符串）',
  })
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString({ message: '子账号加价必须是字符串' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: '子账号加价必须是正数，最多两位小数',
  })
  subAccountAmountDisplay?: string;
}

/**
 * PATCH /pulse/membership/admin/members/:id/deal-price/sub-account
 * 补录 / 撤销存量门店的子账号加价 —— 只动子账号字段，不改写成交总额
 */
export class PulseAdminMemberSubAccountAmountBackfillDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

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
  @Transform(({ value }: { value: unknown }) => {
    if (typeof value !== 'string') {
      return value;
    }

    const trimmedValue = value.trim();
    // 空串必须转成 undefined：@IsOptional 只跳过 null / undefined，
    // 留着空串会被下面的 @Matches 判为非法 → 400，撤销补录就永远提交不了
    return trimmedValue === '' ? undefined : trimmedValue;
  })
  @IsString({ message: '子账号加价必须是字符串' })
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: '子账号加价必须是正数，最多两位小数',
  })
  subAccountAmountDisplay?: string;

  @ApiPropertyOptional({
    example: 3,
    description: '子账号数量，范围 0~10；撤销补录时一并清空',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountAmountBackfillDto) =>
      dto.subAccountCount !== undefined,
  )
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '子账号数量必须是整数' })
  @Min(0, { message: '子账号数量不能小于 0' })
  @Max(10, { message: '子账号数量不能超过 10' })
  subAccountCount?: number;
}

export class PulseAdminMemberSubAccountQuotaRoleSummaryDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @Type(() => Number)
  @IsInt({ message: '槽位序号必须是整数' })
  @Min(1, { message: '槽位序号不能小于 1' })
  @Max(10, { message: '槽位序号不能超过 10' })
  slot: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色，仅支持 cashier / finance / manager',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: PulseSubAccountRoleValue;

  @ApiPropertyOptional({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态，默认 active',
  })
  @IsOptional()
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES, { message: '子账号状态不合法' })
  status?: PulseSubAccountStatusValue;

  @ApiPropertyOptional({ example: false, description: '是否已分配员工' })
  @IsOptional()
  @IsBoolean({ message: '是否已分配员工必须是布尔值' })
  isAssigned?: boolean;
}

export class PulseAdminMemberSubAccountQuotaDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiProperty({ example: 2, description: '目标子账号额度，范围 0~10' })
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountQuotaDto) =>
      dto.subAccountQuota === undefined,
  )
  @Transform(({ value, obj }) => {
    const raw = value ?? obj?.subAccountQuota;
    if (raw === undefined || raw === null || raw === '') {
      return undefined;
    }
    return Number(raw);
  })
  @IsInt({ message: '子账号额度必须是整数' })
  @Min(0, { message: '子账号额度不能小于 0' })
  @Max(10, { message: '子账号额度不能超过 10' })
  quota!: number;

  @ApiPropertyOptional({
    example: 2,
    description: '兼容旧请求的子账号额度字段，范围 0~10',
  })
  @IsOptional()
  @ValidateIf(
    (dto: PulseAdminMemberSubAccountQuotaDto) => dto.quota === undefined,
  )
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') {
      return undefined;
    }
    return Number(value);
  })
  @IsInt({ message: '子账号额度必须是整数' })
  @Min(0, { message: '子账号额度不能小于 0' })
  @Max(10, { message: '子账号额度不能超过 10' })
  subAccountQuota?: number;

  @ApiPropertyOptional({ example: '年会员权益升级', description: '调整原因' })
  @IsOptional()
  @IsString({ message: '调整原因必须是字符串' })
  @MaxLength(100, { message: '调整原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({
    type: [PulseAdminMemberSubAccountQuotaRoleSummaryDto],
    description: '兼容 purelyPulse 前端的槽位角色摘要提交',
  })
  @IsOptional()
  @IsArray({ message: '槽位角色摘要必须是数组' })
  @ValidateNested({ each: true })
  @Type(() => PulseAdminMemberSubAccountQuotaRoleSummaryDto)
  roleSummary?: PulseAdminMemberSubAccountQuotaRoleSummaryDto[];
}

export class PulseAdminMemberSubAccountSlotDto {
  @ApiProperty({ example: 1, description: '子账号槽位序号，范围 1~10' })
  @Type(() => Number)
  @IsInt({ message: '槽位序号必须是整数' })
  @Min(1, { message: '槽位序号不能小于 1' })
  @Max(10, { message: '槽位序号不能超过 10' })
  slotIndex: number;

  @ApiProperty({
    enum: PULSE_SUB_ACCOUNT_ROLE_VALUES,
    description: '子账号角色，仅支持 cashier / finance / manager',
  })
  @IsIn(PULSE_SUB_ACCOUNT_ROLE_VALUES, { message: '子账号角色不合法' })
  role: PulseSubAccountRoleValue;

  @ApiPropertyOptional({
    enum: PULSE_SUB_ACCOUNT_STATUS_VALUES,
    description: '子账号状态，默认 active',
  })
  @IsOptional()
  @IsIn(PULSE_SUB_ACCOUNT_STATUS_VALUES, { message: '子账号状态不合法' })
  status?: PulseSubAccountStatusValue;

  @ApiPropertyOptional({
    example: 18,
    description: '分配的员工 ID，不传或 null 表示清空分配',
  })
  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') {
      return null;
    }
    return Number(value);
  })
  @IsInt({ message: '员工 ID 必须是整数' })
  employeeId?: number | null;

  @ApiPropertyOptional({
    example: true,
    description: '是否允许首页访问，默认跟随状态',
  })
  @IsOptional()
  @IsBoolean({ message: '首页访问开关必须是布尔值' })
  canAccessHome?: boolean;

  @ApiPropertyOptional({
    example: true,
    description: '是否允许交班，默认跟随状态',
  })
  @IsOptional()
  @IsBoolean({ message: '交班开关必须是布尔值' })
  canUseHandover?: boolean;
}

export class PulseAdminMemberStatusDto {
  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的会员 ID' })
  @IsOptional()
  @IsString()
  memberId?: string;

  @ApiPropertyOptional({ example: '1', description: '兼容旧请求的主键 ID' })
  @IsOptional()
  @IsString()
  id?: string;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_STATUS_VALUES,
    description: '目标会员状态',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  status?: PulseMemberStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_STATUS_VALUES,
    description: '兼容旧请求的会员状态字段',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_STATUS_VALUES, { message: '会员状态不合法' })
  memberStatus?: PulseMemberStatusValue;

  @ApiPropertyOptional({ example: '涉嫌异常操作', description: '操作原因' })
  @IsOptional()
  @IsString({ message: '操作原因必须是字符串' })
  @MaxLength(100, { message: '操作原因最多 100 位' })
  reason?: string;

  @ApiPropertyOptional({
    example: '涉嫌异常操作',
    description: '兼容旧请求的备注字段',
  })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(100, { message: '备注最多 100 位' })
  remark?: string;
}

/**
 * GET /pulse/membership/admin/members
 * 管理员获取会员列表 — 查询参数
 */
export class GetPulseAdminMembersQueryDto {
  @ApiPropertyOptional({
    example: true,
    description:
      '只看「有子账号能力但成交价快照里缺子账号加价」的门店，供运营批量补录。' +
      '这些门店的续费价只按当前配置价收，等于白送子账号权益',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '待补录筛选必须是布尔值' })
  pendingSubAccountBackfill?: boolean;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_STATUS_VALUES,
    description: '会员状态筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_STATUS_VALUES, { message: '会员状态筛选不合法' })
  status?: PulseMemberFilterStatusValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_LEVEL_VALUES,
    description: '会员等级筛选，不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_LEVEL_VALUES, { message: '会员等级筛选不合法' })
  level?: PulseMemberFilterLevelValue;

  @ApiPropertyOptional({
    enum: PULSE_MEMBER_FILTER_EXPIRY_VALUES,
    description: '会员到期时间筛选（相对当前时间），不传返回全部',
  })
  @IsOptional()
  @IsIn(PULSE_MEMBER_FILTER_EXPIRY_VALUES, {
    message: '会员到期时间筛选不合法',
  })
  expiry?: PulseMemberFilterExpiryValue;

  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回合伙人，兼容 partner=true 查询',
  })
  @IsOptional()
  @Transform(({ value }) => toOptionalBoolean(value))
  @IsBoolean({ message: '合伙人筛选标记必须是布尔值' })
  partner?: boolean;

  @ApiPropertyOptional({
    example: '刘梅',
    description: '搜索关键词（姓名 / 手机号）',
  })
  @IsOptional()
  @IsString({ message: '搜索关键词必须是字符串' })
  keyword?: string;
}
