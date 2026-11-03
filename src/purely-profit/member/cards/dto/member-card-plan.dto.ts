// 会员卡模板入参 DTO：金额按「元」接收，计数类字段按整数接收，业务口径校验在此收敛
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDefined,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateIf,
} from 'class-validator';
import {
  transformNullableInt,
  transformNullableYuan,
  trimString,
} from '../../../marketing/dto/marketing-product-transforms';
import { transformOptionalInt } from '../../../stores/dto/store-response.dto';
import {
  MEMBER_CARD_KIND_VALUES,
  MEMBER_CARD_PLAN_NAME_MAX_LENGTH,
  MEMBER_CARD_PLAN_PRICE_MAX,
  MEMBER_CARD_PLAN_SPACE_TYPE_MAX_LENGTH,
  MEMBER_CARD_PLAN_SPACE_TYPES_MAX,
  MEMBER_CARD_PLAN_TIMES_MAX,
  MEMBER_CARD_PLAN_VALID_DAYS_MAX,
  MEMBER_CARD_TIMES_KIND,
  type MemberCardKindValue,
} from '../member-card-plan.constants';

/**
 * 新增会员卡模板。
 *
 * `storeId` 不属于请求体，由 query 显式传入并做权限校验；
 * `totalTimes` 仅在 kind=times 时必填，时长卡带该字段会在 service 层被拒绝。
 */
export class CreateMemberCardPlanDto {
  @ApiProperty({ example: '年度畅练卡', description: '卡名称' })
  @IsString({ message: '卡名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '卡名称不能为空' })
  @MaxLength(MEMBER_CARD_PLAN_NAME_MAX_LENGTH, {
    message: `卡名称最长 ${MEMBER_CARD_PLAN_NAME_MAX_LENGTH} 个字符`,
  })
  name: string;

  @ApiProperty({
    example: 'yearly',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型：monthly/quarterly/yearly 为时长卡，times 为次数卡',
  })
  @IsIn(MEMBER_CARD_KIND_VALUES, { message: '卡类型不合法' })
  kind: MemberCardKindValue;

  @ApiProperty({ example: 1999, description: '售价，单位：元' })
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '售价必须是数字' },
  )
  @IsPositive({ message: '售价必须大于 0' })
  @Max(MEMBER_CARD_PLAN_PRICE_MAX, {
    message: `售价不能超过 ${MEMBER_CARD_PLAN_PRICE_MAX} 元`,
  })
  price: number;

  @ApiPropertyOptional({
    example: 2599,
    description: '划线价，单位：元（仅展示用，不得低于售价）',
  })
  @IsOptional()
  @Transform(transformNullableYuan)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '划线价必须是数字' },
  )
  @IsPositive({ message: '划线价必须大于 0' })
  @Max(MEMBER_CARD_PLAN_PRICE_MAX, {
    message: `划线价不能超过 ${MEMBER_CARD_PLAN_PRICE_MAX} 元`,
  })
  originalPrice?: number | null;

  @ApiProperty({
    example: 365,
    description:
      '有效天数：时长卡为有效期内不限次，次数卡为次数未用完时的兜底期限',
  })
  @IsInt({ message: '有效天数必须是整数' })
  @Min(1, { message: '有效天数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_VALID_DAYS_MAX, {
    message: `有效天数不能超过 ${MEMBER_CARD_PLAN_VALID_DAYS_MAX} 天`,
  })
  validDays: number;

  @ApiPropertyOptional({
    example: 20,
    description: '总次数（kind=times 时必填；时长卡不传）',
  })
  @ValidateIf((o: CreateMemberCardPlanDto) => o.kind === MEMBER_CARD_TIMES_KIND)
  @IsDefined({ message: '次数卡必须填写总次数' })
  @Transform(transformNullableInt)
  @IsInt({ message: '总次数必须是整数' })
  @Min(1, { message: '总次数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `总次数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  totalTimes?: number | null;

  @ApiPropertyOptional({ example: 1, description: '一次开台扣减次数，默认 1' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '单次扣减次数必须是整数' })
  @Min(1, { message: '单次扣减次数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `单次扣减次数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  perUseTimes?: number;

  @ApiPropertyOptional({
    example: ['billiards'],
    type: [String],
    description: '可用空间类型编码；不传或空数组表示不限',
  })
  @IsOptional()
  @IsArray({ message: '可用空间类型必须是数组' })
  @ArrayMaxSize(MEMBER_CARD_PLAN_SPACE_TYPES_MAX, {
    message: `可用空间类型最多 ${MEMBER_CARD_PLAN_SPACE_TYPES_MAX} 项`,
  })
  @IsString({ each: true, message: '空间类型编码必须是字符串' })
  @MaxLength(MEMBER_CARD_PLAN_SPACE_TYPE_MAX_LENGTH, {
    each: true,
    message: `空间类型编码最长 ${MEMBER_CARD_PLAN_SPACE_TYPE_MAX_LENGTH} 个字符`,
  })
  usableSpaceTypes?: string[];

  @ApiPropertyOptional({
    example: [1, 2, 3, 4, 5],
    type: [Number],
    description: '可用星期（1-7）；不传或空数组表示不限',
  })
  @IsOptional()
  @IsArray({ message: '可用星期必须是数组' })
  @ArrayMaxSize(7, { message: '可用星期最多 7 项' })
  @IsInt({ each: true, message: '可用星期必须是整数' })
  @Min(1, { each: true, message: '可用星期必须在 1-7 之间' })
  @Max(7, { each: true, message: '可用星期必须在 1-7 之间' })
  usableWeekdays?: number[];

  @ApiPropertyOptional({
    example: 4,
    description: '单次开台最多人数，不传表示不限',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '单次最多人数必须是整数' })
  @Min(1, { message: '单次最多人数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `单次最多人数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  maxGuestPerUse?: number | null;

  @ApiPropertyOptional({
    example: 2,
    description: '每人限购张数，不传表示不限',
  })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '每人限购张数必须是整数' })
  @Min(1, { message: '每人限购张数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `每人限购张数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  purchaseLimit?: number | null;

  @ApiPropertyOptional({ example: true, description: '是否上架，默认 true' })
  @IsOptional()
  @IsBoolean({ message: '上架状态必须是布尔值' })
  isActive?: boolean;
}

/**
 * 编辑会员卡模板：全部字段可选，未下发字段保持后端原值。
 * 划线价 / 总次数 / 单次人数 / 每人限购 显式传 null 表示清空。
 */
export class UpdateMemberCardPlanDto {
  @ApiPropertyOptional({ example: '年度畅练卡', description: '卡名称' })
  @IsOptional()
  @IsString({ message: '卡名称必须是字符串' })
  @Transform(trimString)
  @MinLength(1, { message: '卡名称不能为空' })
  @MaxLength(MEMBER_CARD_PLAN_NAME_MAX_LENGTH, {
    message: `卡名称最长 ${MEMBER_CARD_PLAN_NAME_MAX_LENGTH} 个字符`,
  })
  name?: string;

  @ApiPropertyOptional({
    example: 'times',
    enum: MEMBER_CARD_KIND_VALUES,
    description: '卡类型：切换为 times 时必须同时提供总次数',
  })
  @IsOptional()
  @IsIn(MEMBER_CARD_KIND_VALUES, { message: '卡类型不合法' })
  kind?: MemberCardKindValue;

  @ApiPropertyOptional({ example: 1999, description: '售价，单位：元' })
  @IsOptional()
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '售价必须是数字' },
  )
  @IsPositive({ message: '售价必须大于 0' })
  @Max(MEMBER_CARD_PLAN_PRICE_MAX, {
    message: `售价不能超过 ${MEMBER_CARD_PLAN_PRICE_MAX} 元`,
  })
  price?: number;

  @ApiPropertyOptional({
    example: 2599,
    description: '划线价，单位：元；传 null 表示清空',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableYuan)
  @IsNumber(
    { allowNaN: false, allowInfinity: false },
    { message: '划线价必须是数字' },
  )
  @IsPositive({ message: '划线价必须大于 0' })
  @Max(MEMBER_CARD_PLAN_PRICE_MAX, {
    message: `划线价不能超过 ${MEMBER_CARD_PLAN_PRICE_MAX} 元`,
  })
  originalPrice?: number | null;

  @ApiPropertyOptional({ example: 365, description: '有效天数' })
  @IsOptional()
  @IsInt({ message: '有效天数必须是整数' })
  @Min(1, { message: '有效天数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_VALID_DAYS_MAX, {
    message: `有效天数不能超过 ${MEMBER_CARD_PLAN_VALID_DAYS_MAX} 天`,
  })
  validDays?: number;

  @ApiPropertyOptional({
    example: 20,
    description: '总次数（仅次数卡有值）；传 null 表示清空（时长卡会自动清空）',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @IsInt({ message: '总次数必须是整数' })
  @Min(1, { message: '总次数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `总次数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  totalTimes?: number | null;

  @ApiPropertyOptional({ example: 1, description: '一次开台扣减次数' })
  @IsOptional()
  @Transform(transformOptionalInt)
  @IsInt({ message: '单次扣减次数必须是整数' })
  @Min(1, { message: '单次扣减次数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `单次扣减次数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  perUseTimes?: number;

  @ApiPropertyOptional({
    example: ['billiards'],
    type: [String],
    description: '可用空间类型编码；空数组表示不限',
  })
  @IsOptional()
  @IsArray({ message: '可用空间类型必须是数组' })
  @ArrayMaxSize(MEMBER_CARD_PLAN_SPACE_TYPES_MAX, {
    message: `可用空间类型最多 ${MEMBER_CARD_PLAN_SPACE_TYPES_MAX} 项`,
  })
  @IsString({ each: true, message: '空间类型编码必须是字符串' })
  @MaxLength(MEMBER_CARD_PLAN_SPACE_TYPE_MAX_LENGTH, {
    each: true,
    message: `空间类型编码最长 ${MEMBER_CARD_PLAN_SPACE_TYPE_MAX_LENGTH} 个字符`,
  })
  usableSpaceTypes?: string[];

  @ApiPropertyOptional({
    example: [1, 2, 3, 4, 5],
    type: [Number],
    description: '可用星期（1-7）；空数组表示不限',
  })
  @IsOptional()
  @IsArray({ message: '可用星期必须是数组' })
  @ArrayMaxSize(7, { message: '可用星期最多 7 项' })
  @IsInt({ each: true, message: '可用星期必须是整数' })
  @Min(1, { each: true, message: '可用星期必须在 1-7 之间' })
  @Max(7, { each: true, message: '可用星期必须在 1-7 之间' })
  usableWeekdays?: number[];

  @ApiPropertyOptional({
    example: 4,
    description: '单次开台最多人数；传 null 表示不限',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @IsInt({ message: '单次最多人数必须是整数' })
  @Min(1, { message: '单次最多人数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `单次最多人数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  maxGuestPerUse?: number | null;

  @ApiPropertyOptional({
    example: 2,
    description: '每人限购张数；传 null 表示不限',
    nullable: true,
  })
  @IsOptional()
  @Transform(transformNullableInt)
  @IsInt({ message: '每人限购张数必须是整数' })
  @Min(1, { message: '每人限购张数必须大于 0' })
  @Max(MEMBER_CARD_PLAN_TIMES_MAX, {
    message: `每人限购张数不能超过 ${MEMBER_CARD_PLAN_TIMES_MAX}`,
  })
  purchaseLimit?: number | null;

  @ApiPropertyOptional({ example: false, description: '是否上架' })
  @IsOptional()
  @IsBoolean({ message: '上架状态必须是布尔值' })
  isActive?: boolean;
}
