import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { transformOptionalBoolean } from '../../../purely-profit/stores/dto/store-response.dto';
import {
  ClubOrderStatusResponseDto,
  ClubWechatPaymentParamsDto,
} from '../../orders/dto/club-order.dto';

export class ListClubRechargePackagesQueryDto {
  @ApiPropertyOptional({
    example: true,
    description: '是否仅返回首页预览套餐；传 true 时默认返回前 3 条',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'preview 必须是布尔值' })
  preview?: boolean;
}

export class CreateClubRechargeOrderDto {
  @ApiProperty({ example: 11, description: '当前选中的门店 ID' })
  @Type(() => Number)
  @IsInt({ message: 'storeId 必须是整数' })
  storeId: number;

  @ApiPropertyOptional({
    example: '18',
    description: '充值套餐 ID；选择套餐时必填',
  })
  @IsOptional()
  @IsString({ message: 'packageId 必须是字符串' })
  packageId?: string;

  @ApiPropertyOptional({
    example: 268,
    description: '自定义充值金额，单位元；自定义充值时必填，最多保留两位小数',
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber(
    { allowInfinity: false, allowNaN: false, maxDecimalPlaces: 2 },
    { message: 'customAmount 必须是合法金额，且最多保留两位小数' },
  )
  @Min(0.01, { message: '自定义充值金额最小 0.01 元' })
  @Max(50000, { message: '自定义充值金额最大 50000 元' })
  customAmount?: number;

  @ApiPropertyOptional({
    example: 'oLSdB5A3FRSxSCKrGNGKBhYQ_xyz',
    description:
      '微信用户 openid；前端通过 wx.login 换取后传入，用于 JSAPI 下单',
  })
  @IsOptional()
  @IsString({ message: 'openid 必须是字符串' })
  openid?: string;
}

export class ClubRechargePackageDto {
  @ApiProperty({ example: '18', description: '充值套餐 ID' })
  @IsString({ message: '充值套餐 ID 必须是字符串' })
  id: string;

  @ApiProperty({ example: 500, description: '充值金额，单位元' })
  amount: number;

  @ApiProperty({ example: 80, description: '赠送金额，单位元' })
  bonusAmount: number;

  @ApiPropertyOptional({ example: '最受欢迎', description: '套餐标签' })
  @IsOptional()
  @IsString({ message: '套餐标签必须是字符串' })
  tag?: string;

  @ApiProperty({ example: true, description: '是否推荐套餐' })
  @IsBoolean({ message: '推荐标记必须是布尔值' })
  recommended: boolean;
}

export class ClubRechargePackagesResponseDto {
  @ApiProperty({ type: [ClubRechargePackageDto], description: '充值套餐列表' })
  items: ClubRechargePackageDto[];
}

export class ClubRechargeOrderResponseDto extends ClubOrderStatusResponseDto {
  @ApiProperty({ example: 500, description: '充值金额，单位元' })
  rechargeAmount: number;

  @ApiProperty({ example: 80, description: '赠送金额，单位元' })
  bonusAmount: number;

  @ApiPropertyOptional({
    example: '18',
    description: '充值套餐 ID；自定义充值时为空',
  })
  @IsOptional()
  @IsString({ message: 'packageId 必须是字符串' })
  packageId: string | null;

  @ApiProperty({
    type: ClubWechatPaymentParamsDto,
    description: '发起微信支付所需参数',
  })
  paymentParams: ClubWechatPaymentParamsDto;
}
