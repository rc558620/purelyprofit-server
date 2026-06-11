import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsNumber, IsOptional, IsString } from 'class-validator';
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
}
