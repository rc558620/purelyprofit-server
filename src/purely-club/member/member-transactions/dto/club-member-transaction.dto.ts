import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import {
  CLUB_RECORD_FILTER_VALUES,
  CLUB_RECORD_TYPE_VALUES,
  type ClubRecordFilterValue,
  type ClubRecordTypeValue,
} from '../../../records/dto/club-record.dto';

export const CLUB_MEMBER_TRANSACTION_FILTER_VALUES = CLUB_RECORD_FILTER_VALUES;
export type ClubMemberTransactionFilterValue = ClubRecordFilterValue;
export type ClubMemberTransactionTypeValue = ClubRecordTypeValue;

export class ListClubMemberTransactionsQueryDto {
  @ApiPropertyOptional({
    example: 'all',
    enum: CLUB_MEMBER_TRANSACTION_FILTER_VALUES,
    description:
      '会员交易筛选类型：all=全部 recharge=充值与赠送 consume=消费与退款',
  })
  @IsOptional()
  @IsIn(CLUB_MEMBER_TRANSACTION_FILTER_VALUES, {
    message: '会员交易筛选类型不合法',
  })
  type?: ClubMemberTransactionFilterValue;

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
    example: '2024-11-20T10:30:00.000Z',
    description:
      '分页游标：上一页最后一条交易的 createdAt（ISO 字符串），用于加载更早的记录',
  })
  @IsOptional()
  @IsString({ message: 'cursorCreatedAt 必须是字符串' })
  cursorCreatedAt?: string;

  @ApiPropertyOptional({
    example: 'consume-31',
    description:
      '分页游标：上一页最后一条交易的 ID，与 cursorCreatedAt 配合使用',
  })
  @IsOptional()
  @IsString({ message: 'cursorId 必须是字符串' })
  cursorId?: string;
}

export class ClubMemberTransactionDto {
  @ApiProperty({ example: 'recharge-18', description: '会员交易 ID' })
  @IsString({ message: '会员交易 ID 必须是字符串' })
  id: string;

  @ApiProperty({
    example: 'recharge',
    enum: CLUB_RECORD_TYPE_VALUES,
    description: '会员交易类型',
  })
  @IsIn(CLUB_RECORD_TYPE_VALUES, { message: '会员交易类型不合法' })
  type: ClubMemberTransactionTypeValue;

  @ApiProperty({
    example: 500,
    description: '展示金额，单位元；收入为正，支出为负',
  })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '会员交易金额必须是最多两位小数的数字' },
  )
  amount: number;

  @ApiProperty({ example: '充值 ¥500 赠 ¥80', description: '会员交易描述' })
  @IsString({ message: '会员交易描述必须是字符串' })
  description: string;

  @ApiProperty({
    example: '2024-11-20T10:30:00.000Z',
    description: '交易时间 ISO 字符串',
  })
  @IsString({ message: '交易时间必须是字符串' })
  createdAt: string;

  @ApiProperty({ example: 580, description: '该笔交易后的余额快照，单位元' })
  @IsNumber(
    { maxDecimalPlaces: 2 },
    { message: '余额快照必须是最多两位小数的数字' },
  )
  balanceSnapshot: number;

  @ApiPropertyOptional({
    example: '望京旗舰店',
    description: '交易所属门店名称',
  })
  @IsOptional()
  @IsString({ message: '交易所属门店名称必须是字符串' })
  storeName?: string;
}

export class ClubMemberTransactionsResponseDto {
  @ApiProperty({
    type: [ClubMemberTransactionDto],
    description: '当前会员统一交易流水列表',
  })
  items: ClubMemberTransactionDto[];

  @ApiProperty({
    example: 128,
    description: '符合条件的交易流水总条数',
  })
  total: number;

  @ApiPropertyOptional({
    example: '2024-11-18T14:20:00.000Z',
    description: '下一页游标的 createdAt 值；为 null 表示已到最后一页',
    nullable: true,
  })
  nextCursorCreatedAt: string | null;

  @ApiPropertyOptional({
    example: 'consume-31',
    description: '下一页游标的 ID 值；为 null 表示已到最后一页',
    nullable: true,
  })
  nextCursorId: string | null;
}
