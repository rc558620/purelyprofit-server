// 商家端售卡订单接口：售卡订单列表（状态 / 来源筛选，门店维度分页）
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import {
  AllowLegacyOwnerAccess,
  RequirePermissions,
} from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { RequireBusinessMode } from '../../stores/business-mode.decorator';
import { BusinessModeGuard } from '../../stores/business-mode.guard';
import { ListMemberCardOrdersQueryDto } from './dto/member-card-order-query.dto';
import { MemberCardOrdersResponseDto } from './dto/member-card-order.response.dto';
import { MemberCardOrdersService } from './member-card-orders.service';

/**
 * 售卡订单路由挂在营销域路径下（前端契约固定为 /marketing/member-card-orders）。
 *
 * 单独成 controller 而不是并入持卡 controller：路径前缀不同，
 * 且在 Nest 里同一 controller 只能持有一个 @Controller 前缀。
 */
@ApiTags('营销中心 - 会员卡')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('marketing/member-card-orders')
export class MemberCardOrdersController {
  constructor(
    private readonly memberCardOrdersService: MemberCardOrdersService,
  ) {}

  @Get()
  @RequirePermissions('member-card:view')
  @ApiOperation({
    summary: '售卡订单列表',
    description:
      '按门店分页返回售卡订单（含 C 端购卡与历史线下单据），支持订单状态 / 来源渠道筛选；手机号脱敏返回',
  })
  @ApiOkResponse({ type: MemberCardOrdersResponseDto })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberCardOrdersQueryDto,
  ): Promise<MemberCardOrdersResponseDto> {
    return this.memberCardOrdersService.listOrders(user, query);
  }
}
