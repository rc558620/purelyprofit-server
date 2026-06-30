import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export const CLUB_MEMBER_LEVEL_VALUES = [
  'regular',
  'gold',
  'platinum',
  'diamond',
] as const;
export const CLUB_MEMBER_HELD_LEVEL_VALUES = [
  'regular',
  'gold',
  'platinum',
  'diamond',
] as const;

export type ClubMemberLevelValue = (typeof CLUB_MEMBER_LEVEL_VALUES)[number];
export type ClubMemberHeldLevelValue =
  (typeof CLUB_MEMBER_HELD_LEVEL_VALUES)[number];

function trimStringValue(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}

export class UpdateClubMemberAvatarDto {
  @ApiProperty({
    example: 'https://cdn.example.com/avatar/club-user.png',
    description: '头像地址或 base64 数据，传空串表示清空头像',
  })
  @Transform(({ value }: { value: unknown }) => trimStringValue(value))
  @IsString({ message: '头像必须是字符串' })
  avatar: string;
}

export class UpdateClubMemberNicknameDto {
  @ApiProperty({ example: '小王', description: '当前 purely-club 用户昵称' })
  @Transform(({ value }: { value: unknown }) => trimStringValue(value))
  @IsString({ message: '昵称必须是字符串' })
  @MinLength(1, { message: '昵称不能为空' })
  @MaxLength(20, { message: '昵称最长 20 个字符' })
  nickname: string;
}

export class ClubMemberProfileDto {
  @ApiProperty({ example: '201', description: '当前 purely-club 用户 ID' })
  @IsString({ message: '当前 purely-club 用户 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '13800138000', description: '当前登录手机号' })
  @IsString({ message: '当前登录手机号必须是字符串' })
  phone: string;

  @ApiProperty({
    example: '小王',
    description: '当前用户昵称，未设置时返回空串',
  })
  @IsString({ message: '当前用户昵称必须是字符串' })
  nickname: string;

  @ApiProperty({ example: '', description: '当前用户头像，未设置时返回空串' })
  @IsString({ message: '当前用户头像必须是字符串' })
  avatar: string;
}

export class ClubMemberAccountDto {
  @ApiProperty({ example: '201', description: '会员 ID' })
  @IsString({ message: '会员 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: '11', description: '当前门店 ID' })
  @IsString({ message: '当前门店 ID 必须是字符串' })
  storeId: string;

  @ApiProperty({ example: 350, description: '当前储值余额，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '当前储值余额必须是最多两位小数的数字' },
  )
  balance: number;

  @ApiProperty({
    example: 'gold',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    description: '当前会员等级',
  })
  @IsIn(CLUB_MEMBER_LEVEL_VALUES, { message: '当前会员等级不合法' })
  level: ClubMemberLevelValue;

  @ApiProperty({ example: 1280, description: '当前积分余额' })
  @IsNumber({}, { message: '当前积分余额必须是数字' })
  points: number;

  @ApiProperty({ example: 'PC20240601001', description: '会员码' })
  @IsString({ message: '会员码必须是字符串' })
  memberCode: string;

  @ApiProperty({ example: '2024-06-01', description: '入会日期' })
  @IsString({ message: '入会日期必须是字符串' })
  joinDate: string;

  @ApiProperty({ example: 3200, description: '累计充值金额，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '累计充值金额必须是最多两位小数的数字' },
  )
  totalConsume: number;

  @ApiPropertyOptional({
    example: 'gold',
    enum: CLUB_MEMBER_HELD_LEVEL_VALUES,
    nullable: true,
    description: '当前已持有等级',
  })
  @IsOptional()
  @IsIn(CLUB_MEMBER_HELD_LEVEL_VALUES, { message: '已持有等级不合法' })
  heldLevel?: ClubMemberHeldLevelValue | null;

  @ApiPropertyOptional({
    example: '黄金会员',
    nullable: true,
    description: '当前已持有等级名称',
  })
  @IsOptional()
  @IsString({ message: '已持有等级名称必须是字符串' })
  heldLevelLabel?: string | null;

  @ApiPropertyOptional({
    example: false,
    nullable: true,
    description: '当前已持有等级是否仍在可展示等级列表中',
  })
  @IsOptional()
  @IsBoolean({ message: '已持有等级展示标识必须是布尔值' })
  heldLevelVisible?: boolean;
}

export class ClubMemberLevelConfigDto {
  @ApiProperty({
    example: 'gold',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    description: '会员等级标识',
  })
  @IsIn(CLUB_MEMBER_LEVEL_VALUES, { message: '会员等级标识不合法' })
  level: ClubMemberLevelValue;

  @ApiProperty({ example: '黄金会员', description: '会员等级名称' })
  @IsString({ message: '会员等级名称必须是字符串' })
  label: string;

  @ApiProperty({ example: '#b7862f', description: '等级主色' })
  @IsString({ message: '等级主色必须是字符串' })
  color: string;

  @ApiProperty({ example: '#fbf3df', description: '等级背景色' })
  @IsString({ message: '等级背景色必须是字符串' })
  bgColor: string;

  @ApiProperty({ example: 3000, description: '升级所需累计充值金额，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '升级门槛必须是最多两位小数的数字' },
  )
  requiredConsume: number;

  @ApiProperty({ example: 0.9, description: '会员折扣率，0.9 表示 9 折' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '会员折扣率必须是最多两位小数的数字' },
  )
  discountRate: number;

  @ApiProperty({
    example: '9折',
    description: '折扣展示文案；前端直接渲染，禁止再做 discountRate 推导',
  })
  @IsString({ message: '折扣展示文案必须是字符串' })
  discountText: string;

  @ApiProperty({
    example: '再充值 ¥500 升级',
    description: '升级提示文案；前端直接渲染，禁止再做 requiredConsume - totalConsume 计算',
  })
  @IsString({ message: '升级提示文案必须是字符串' })
  upgradeHintText: string;

  @ApiProperty({
    example: ['9 折会员专属价', '专属客服顾问'],
    description: '会员权益列表',
    type: [String],
  })
  @IsArray({ message: '会员权益列表必须是数组' })
  @IsString({ each: true, message: '会员权益项必须是字符串' })
  benefits: string[];
}

export class ClubMemberLevelStatusDto {
  @ApiProperty({
    example: 'gold',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    description: '当前会员等级',
  })
  @IsIn(CLUB_MEMBER_LEVEL_VALUES, { message: '当前会员等级不合法' })
  currentLevel: ClubMemberLevelValue;

  @ApiProperty({ example: '黄金会员', description: '当前会员等级名称' })
  @IsString({ message: '当前会员等级名称必须是字符串' })
  currentLevelLabel: string;

  @ApiProperty({ example: 3000, description: '当前等级门槛，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '当前等级门槛必须是最多两位小数的数字' },
  )
  currentRequiredConsume: number;

  @ApiProperty({ example: 3200, description: '累计充值金额，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '累计充值金额必须是最多两位小数的数字' },
  )
  totalConsume: number;

  @ApiPropertyOptional({
    example: 'platinum',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    nullable: true,
    description: '下一等级；已达最高等级时为 null',
  })
  @IsOptional()
  @IsIn(CLUB_MEMBER_LEVEL_VALUES, { message: '下一等级不合法' })
  nextLevel: ClubMemberLevelValue | null;

  @ApiPropertyOptional({
    example: '铂金会员',
    nullable: true,
    description: '下一等级名称；已达最高等级时为 null',
  })
  @IsOptional()
  @IsString({ message: '下一等级名称必须是字符串' })
  nextLevelLabel: string | null;

  @ApiPropertyOptional({
    example: 5000,
    nullable: true,
    description: '下一等级门槛，单位元；已达最高等级时为 null',
  })
  @IsOptional()
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '下一等级门槛必须是最多两位小数的数字' },
  )
  nextRequiredConsume: number | null;

  @ApiProperty({
    example: 1800,
    description: '距离下一等级还需消费金额，单位元',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '升级差额必须是最多两位小数的数字' },
  )
  amountToNextLevel: number;

  @ApiProperty({ example: 64, description: '升级进度百分比，0-100' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '升级进度必须是最多两位小数的数字' },
  )
  progressPct: number;

  @ApiProperty({ example: false, description: '是否已达最高等级' })
  @IsBoolean({ message: '最高等级标识必须是布尔值' })
  isTopLevel: boolean;

  @ApiPropertyOptional({
    example: 'gold',
    enum: CLUB_MEMBER_HELD_LEVEL_VALUES,
    nullable: true,
    description: '当前已持有等级；与展示等级一致时可与 currentLevel 相同',
  })
  @IsOptional()
  @IsIn(CLUB_MEMBER_HELD_LEVEL_VALUES, { message: '已持有等级不合法' })
  heldLevel?: ClubMemberHeldLevelValue | null;

  @ApiPropertyOptional({
    example: '铂金会员',
    nullable: true,
    description: '当前已持有等级名称',
  })
  @IsOptional()
  @IsString({ message: '已持有等级名称必须是字符串' })
  heldLevelLabel?: string | null;

  @ApiPropertyOptional({
    example: false,
    nullable: true,
    description: '当前已持有等级是否仍在可展示等级列表中',
  })
  @IsOptional()
  @IsBoolean({ message: '已持有等级展示标识必须是布尔值' })
  heldLevelVisible?: boolean;
}

// ─── 积分规则配置 ────────────────────────────────────────────────────────────

/**
 * 会员积分规则配置 DTO
 * 用于 serviceDetail 页面计算积分可抵扣的最大金额
 */
export class ClubPointsRatioDto {
  @ApiProperty({
    example: 100,
    description: '多少积分抵扣 1 元；例如 100 表示 100 积分 = 1 元',
  })
  @IsNumber({}, { message: 'redeemRatioPoints 必须是数字' })
  redeemRatioPoints: number;

  @ApiProperty({
    example: 0.5,
    description:
      '单次消费最大积分抵扣比例（0-1）；例如 0.5 表示最多抵扣折后价的 50%',
  })
  @IsNumber({}, { message: 'maxRedeemRatio 必须是数字' })
  maxRedeemRatio: number;

  @ApiProperty({
    example: true,
    description: '积分规则是否启用',
  })
  @IsBoolean({ message: 'enabled 必须是布尔值' })
  enabled: boolean;
}
