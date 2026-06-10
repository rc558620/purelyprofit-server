import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString } from 'class-validator';
import {
  CLUB_ORDER_STATUS_VALUES,
  CLUB_ORDER_TYPE_VALUES,
  type ClubOrderStatusValue,
  type ClubOrderTypeValue,
} from '../../orders/club-order.types';

export class ClubWechatPaymentCallbackDto {
  @ApiProperty({ example: 'RC202606101230001234', description: '业务订单号' })
  @IsString({ message: 'orderNo 必须是字符串' })
  orderNo: string;

  @ApiProperty({
    enum: CLUB_ORDER_TYPE_VALUES,
    description: '订单类型：recharge=充值，service=服务购买',
  })
  @IsIn(CLUB_ORDER_TYPE_VALUES, { message: 'orderType 不合法' })
  orderType: ClubOrderTypeValue;

  @ApiProperty({ example: 50000, description: '支付金额，单位分' })
  @IsInt({ message: 'amountFen 必须是整数' })
  amountFen: number;

  @ApiProperty({
    example: '4200001234202606101234567890',
    description: '微信支付流水号',
  })
  @IsString({ message: 'transactionId 必须是字符串' })
  transactionId: string;

  @ApiProperty({ example: 'SUCCESS', description: '支付结果' })
  @IsIn(['SUCCESS'], { message: 'status 仅支持 SUCCESS' })
  status: 'SUCCESS';

  @ApiProperty({
    example: '2026-06-10T12:31:00.000Z',
    description: '支付完成时间；未传时服务端按当前时间落账',
    required: false,
  })
  @IsOptional()
  @IsString({ message: 'paidAt 必须是字符串' })
  paidAt?: string;
}

export class ClubWechatPaymentCallbackAckDto {
  @ApiProperty({ example: true, description: '是否成功接收并处理回调' })
  success: true;

  @ApiProperty({ example: 'RC202606101230001234', description: '业务订单号' })
  orderNo: string;

  @ApiProperty({
    enum: CLUB_ORDER_TYPE_VALUES,
    description: '订单类型',
  })
  orderType: ClubOrderTypeValue;

  @ApiProperty({
    enum: CLUB_ORDER_STATUS_VALUES,
    description: '当前订单状态',
  })
  status: ClubOrderStatusValue;
}
