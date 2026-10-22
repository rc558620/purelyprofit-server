// 服务详情页首屏聚合响应：商品详情 + 会员账户 + 当前门店 + 积分规则 + 初始规格价格预计算。
//
// 存在意义：serviceDetail 页面原先要打 5 个请求（商品详情 / 会员账户 / 当前门店 /
// 积分比例 / 订单预计算），每个都要各自过一遍鉴权与门店上下文解析，弱网下 RTT 与
// Redis 往返被同等放大。这里收敛成一次往返，与 GET /club/home 的首页聚合同口径。
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ClubMemberAccountDto,
  ClubPointsRatioDto,
} from '../../../member/dto/club-member-account.dto';
import { ClubServiceOrderPreviewResponseDto } from '../../../orders/dto/club-order.dto';
import { ClubVoucherOrderPreviewResponseDto } from '../../../voucher-orders/dto/club-voucher-order.dto';
import { ClubProductDto } from '../../dto/club-product.dto';

export class ClubProductBootstrapResponseDto {
  @ApiProperty({
    type: ClubProductDto,
    description: '当前门店下的服务商品详情',
  })
  product: ClubProductDto;

  @ApiPropertyOptional({
    type: ClubMemberAccountDto,
    nullable: true,
    description: '当前用户在当前门店的会员账户；获取失败或无会员记录时为 null',
  })
  account: ClubMemberAccountDto | null;

  @ApiProperty({
    example: 11,
    description:
      '当前门店 ID（下单必需：服务端强制「下单门店 = 当前门店」）；由拦截器解析的门上下文提供',
  })
  storeId: number;

  @ApiPropertyOptional({
    type: ClubPointsRatioDto,
    nullable: true,
    description:
      '当前门店积分规则配置（展示「N积分抵1元」提示）；获取失败时为 null',
  })
  pointsRatio: ClubPointsRatioDto | null;

  @ApiPropertyOptional({
    type: ClubServiceOrderPreviewResponseDto,
    nullable: true,
    description:
      '初始规格（1 件）的服务订单价格预计算；团购券商品或取价失败时为 null（前端降级为仅展示商品价）',
  })
  servicePreview: ClubServiceOrderPreviewResponseDto | null;

  @ApiPropertyOptional({
    type: ClubVoucherOrderPreviewResponseDto,
    nullable: true,
    description:
      '初始规格（商品配置人数）的团购券订单价格预计算；非团购券商品或取价失败时为 null',
  })
  voucherPreview: ClubVoucherOrderPreviewResponseDto | null;
}
