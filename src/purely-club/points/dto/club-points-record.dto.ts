import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export const CLUB_POINTS_FILTER_VALUES = ['all', 'earn', 'redeem'] as const;
export type ClubPointsFilterValue = (typeof CLUB_POINTS_FILTER_VALUES)[number];

export const CLUB_POINTS_RECORD_TYPE_VALUES = [
  'earn',
  'redeem',
  'expire',
  'adjust',
] as const;
export type ClubPointsRecordTypeValue =
  (typeof CLUB_POINTS_RECORD_TYPE_VALUES)[number];

export class ListClubPointsRecordsQueryDto {
  @ApiPropertyOptional({
    example: 'all',
    enum: CLUB_POINTS_FILTER_VALUES,
    description: '积分筛选类型：all=全部 earn=获得 redeem=消耗',
  })
  @IsOptional()
  @IsIn(CLUB_POINTS_FILTER_VALUES, { message: '积分筛选类型不合法' })
  type?: ClubPointsFilterValue;

  @ApiPropertyOptional({
    example: 50,
    description: '每页返回条数，默认 50，最大 200',
  })
  @IsOptional()
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(200, { message: 'limit 最大为 200' })
  limit?: number;

  @ApiPropertyOptional({
    example:
      'eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTA4VDA2OjAwOjAzLjI0NVoiLCJpZCI6MTgsInRvdGFsRWZmZWN0IjoxMjB9',
    description:
      '分页游标：上一页响应中的 nextCursor 值，原样回传即可；不传表示第一页。内部编码了上一页最后一条积分的创建时间、ID 与已加载记录累计变动量，用于稳定翻页并保证余额快照连续',
  })
  @IsOptional()
  @IsString({ message: 'cursor 必须是字符串' })
  @MaxLength(256, { message: 'cursor 过长' })
  cursor?: string;
}

export class ClubPointsRecordDto {
  @ApiProperty({ example: 'points-18', description: '积分记录 ID' })
  @IsString({ message: '积分记录 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: 'earn',
    enum: CLUB_POINTS_RECORD_TYPE_VALUES,
    description: '积分变动类型',
  })
  @IsIn(CLUB_POINTS_RECORD_TYPE_VALUES, { message: '积分变动类型不合法' })
  type: ClubPointsRecordTypeValue;

  @ApiProperty({
    example: 120,
    description: '积分变动数量；获得为正，消耗/过期/扣减为负',
  })
  amount: number;

  @ApiProperty({ example: '消费积分', description: '积分变动说明' })
  @IsString({ message: '说明必须是字符串' })
  description: string;

  @ApiProperty({
    example: '2024-11-20T10:30:00.000Z',
    description: '记录时间 ISO 字符串',
  })
  @IsString({ message: '记录时间必须是字符串' })
  createdAt: string;

  @ApiProperty({ example: 580, description: '变动后积分余额快照' })
  balanceSnapshot: number;

  @ApiPropertyOptional({
    example: 'purelyClub · 望京旗舰店',
    description: '关联门店名称',
  })
  @IsOptional()
  @IsString({ message: '门店名称必须是字符串' })
  storeName?: string;
}

export class ClubPointsSummaryDto {
  @ApiProperty({
    example: 580,
    description: '累计获得积分（所有 amount > 0 的记录之和）',
  })
  totalEarned: number;

  @ApiProperty({
    example: 120,
    description: '累计消耗积分（所有 amount < 0 的记录绝对值之和）',
  })
  totalRedeemed: number;
}

export class ClubPointsRecordsResponseDto {
  @ApiProperty({
    type: [ClubPointsRecordDto],
    description: '积分明细列表',
  })
  items: ClubPointsRecordDto[];

  @ApiProperty({ example: 42, description: '符合当前筛选条件的记录总条数' })
  total: number;

  @ApiPropertyOptional({
    example:
      'eyJjcmVhdGVkQXQiOiIyMDI2LTA4LTA4VDA2OjAwOjAzLjI0NVoiLCJpZCI6MTgsInRvdGFsRWZmZWN0IjoxMjB9',
    description:
      '下一页游标值，原样传给下次请求的 cursor 参数即可；为 null 表示已到最后一页',
    nullable: true,
  })
  nextCursor: string | null;

  @ApiProperty({
    description: '积分汇总统计',
    type: ClubPointsSummaryDto,
  })
  summary: ClubPointsSummaryDto;
}
