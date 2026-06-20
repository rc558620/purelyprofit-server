import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
} from 'class-validator';
import {
  CLUB_MEMBER_HELD_LEVEL_VALUES,
  CLUB_MEMBER_LEVEL_VALUES,
  type ClubMemberHeldLevelValue,
  type ClubMemberLevelValue,
} from '../../dto/club-member-account.dto';

export class ClubMemberBenefitLevelDto {
  @ApiProperty({
    example: 'gold',
    enum: CLUB_MEMBER_LEVEL_VALUES,
    description: '权益所属等级',
  })
  @IsIn(CLUB_MEMBER_LEVEL_VALUES, { message: '权益所属等级不合法' })
  level: ClubMemberLevelValue;

  @ApiProperty({ example: '黄金会员', description: '权益所属等级名称' })
  @IsString({ message: '权益所属等级名称必须是字符串' })
  label: string;

  @ApiProperty({ example: 0.9, description: '该等级折扣率，0.9 表示 9 折' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '等级折扣率必须是最多两位小数的数字' },
  )
  discountRate: number;

  @ApiProperty({
    type: [String],
    example: ['9 折会员专属价', '专属客服顾问'],
    description: '该等级可享有的权益列表',
  })
  @IsArray({ message: '等级权益列表必须是数组' })
  @IsString({ each: true, message: '等级权益项必须是字符串' })
  benefits: string[];

  @ApiProperty({ example: true, description: '当前会员是否已解锁该等级权益' })
  @IsBoolean({ message: '权益解锁标识必须是布尔值' })
  unlocked: boolean;
}

export class ClubMemberBenefitsDto {
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

  @ApiProperty({
    type: [ClubMemberBenefitLevelDto],
    description: '按等级分组的会员权益列表',
  })
  @IsArray({ message: '会员权益分组必须是数组' })
  items: ClubMemberBenefitLevelDto[];

  @ApiPropertyOptional({
    example: 'gold',
    enum: CLUB_MEMBER_HELD_LEVEL_VALUES,
    nullable: true,
    description: '当前已持有等级；与 currentLevel 不一致时用于提示历史持有等级',
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
    description: '当前已持有等级是否仍在权益展示等级列表中',
  })
  @IsOptional()
  @IsBoolean({ message: '已持有等级展示标识必须是布尔值' })
  heldLevelVisible?: boolean;
}
