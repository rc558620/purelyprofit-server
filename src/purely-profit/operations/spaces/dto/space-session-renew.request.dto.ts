import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';
import {
  SALES_PAYMENT_METHOD_VALUES,
  type SalesPaymentMethodValue,
} from '../../sales-record/sales-record.types';

export class RenewSpaceSessionDto {
  @ApiProperty({ example: 30, description: '续费金额（元）' })
  @Type(() => Number)
  @IsNumber({}, { message: '续费金额必须是数字' })
  @Min(0.01, { message: '续费金额必须大于 0' })
  amount: number;

  @ApiProperty({
    example: 'wechat',
    description: '支付方式',
    enum: SALES_PAYMENT_METHOD_VALUES,
  })
  @IsIn(SALES_PAYMENT_METHOD_VALUES, { message: '支付方式不合法' })
  paymentMethod: SalesPaymentMethodValue;

  @ApiPropertyOptional({ example: 'MT123456', description: '团购券码' })
  @IsOptional()
  @IsString({ message: '团购券码必须是字符串' })
  @MaxLength(50, { message: '团购券码最长 50 个字符' })
  grouponCode?: string;

  @ApiPropertyOptional({ example: '美团', description: '团购平台' })
  @IsOptional()
  @IsString({ message: '团购平台必须是字符串' })
  @MaxLength(50, { message: '团购平台最长 50 个字符' })
  grouponPlatform?: string;

  @ApiPropertyOptional({ example: '补差价', description: '备注' })
  @IsOptional()
  @IsString({ message: '备注必须是字符串' })
  @MaxLength(200, { message: '备注最长 200 个字符' })
  note?: string;
}
