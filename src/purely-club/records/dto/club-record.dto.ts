import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export const CLUB_RECORD_FILTER_VALUES = [
  'all',
  'recharge',
  'consume',
] as const;
export type ClubRecordFilterValue = (typeof CLUB_RECORD_FILTER_VALUES)[number];

export const CLUB_RECORD_TYPE_VALUES = [
  'recharge',
  'consume',
  'refund',
  'bonus',
] as const;
export type ClubRecordTypeValue = (typeof CLUB_RECORD_TYPE_VALUES)[number];

export class ListClubRecordsQueryDto {
  @ApiPropertyOptional({
    example: 'all',
    enum: CLUB_RECORD_FILTER_VALUES,
    description:
      '流水筛选类型：all=全部 recharge=充值 bonus consume=消费 refund',
  })
  @IsOptional()
  @IsIn(CLUB_RECORD_FILTER_VALUES, { message: '流水筛选类型不合法' })
  type?: ClubRecordFilterValue;

  @ApiPropertyOptional({
    example: 50,
    description: '每页返回条数，默认 50，最大 200',
  })
  @IsOptional()
  @IsInt({ message: 'limit 必须是整数' })
  @Min(1, { message: 'limit 最小为 1' })
  @Max(200, { message: 'limit 最大为 200' })
  limit?: number;
}

export class ClubRecordDto {
  @ApiProperty({ example: 'recharge-18', description: '流水 ID' })
  @IsString({ message: '流水 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: 'recharge',
    enum: CLUB_RECORD_TYPE_VALUES,
    description: '流水类型',
  })
  @IsIn(CLUB_RECORD_TYPE_VALUES, { message: '流水类型不合法' })
  type: ClubRecordTypeValue;

  @ApiProperty({
    example: 500,
    description: '展示金额，单位元；收入为正，支出为负',
  })
  amount: number;

  @ApiProperty({ example: '充值 ¥500 赠 ¥80', description: '流水描述' })
  @IsString({ message: '流水描述必须是字符串' })
  description: string;

  @ApiProperty({
    example: '2024-11-20T10:30:00.000Z',
    description: '交易时间 ISO 字符串',
  })
  @IsString({ message: '交易时间必须是字符串' })
  createdAt: string;

  @ApiProperty({ example: 580, description: '该笔流水后的余额快照，单位元' })
  balanceSnapshot: number;

  @ApiPropertyOptional({
    example: 'purelyClub · 望京旗舰店',
    description: '门店名称',
  })
  @IsOptional()
  @IsString({ message: '门店名称必须是字符串' })
  storeName?: string;
}

export class ClubRecordsResponseDto {
  @ApiProperty({ type: [ClubRecordDto], description: '统一流水列表' })
  items: ClubRecordDto[];
}
