import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString } from 'class-validator';

export const CLUB_MEMBER_LEVEL_VALUES = [
  'bronze',
  'silver',
  'gold',
  'platinum',
  'diamond',
] as const;

export type ClubMemberLevelValue = (typeof CLUB_MEMBER_LEVEL_VALUES)[number];

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

  @ApiProperty({ example: 3200, description: '累计消费金额，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '累计消费金额必须是最多两位小数的数字' },
  )
  totalConsume: number;
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

  @ApiProperty({ example: 3000, description: '升级所需累计消费金额，单位元' })
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

  @ApiProperty({ example: 3200, description: '累计消费金额，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '累计消费金额必须是最多两位小数的数字' },
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

  @ApiProperty({ example: 1800, description: '距离下一等级还需消费金额，单位元' })
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
}
