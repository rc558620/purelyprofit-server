import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNumber, IsString } from 'class-validator';

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
