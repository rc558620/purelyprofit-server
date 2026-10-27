import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import { transformOptionalBoolean } from '../../../purely-profit/stores/dto/store-response.dto';

/** 自助点单订单详情查询入参 */
export class ClubSelfOrderStatusQueryDto {
  @ApiPropertyOptional({
    example: true,
    description:
      '是否回微信侧核对真实支付结果；拉起支付后结果未知（unknown）时传 true，' +
      '用于判断用户是否已扣款，避免按失败引导重复支付',
  })
  @IsOptional()
  @Transform(transformOptionalBoolean)
  @IsBoolean({ message: 'verify 必须是布尔值' })
  verify?: boolean;
}
