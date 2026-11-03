// 商家端持卡管理接口：持卡列表 / 详情 / 核销流水 / 手动增减次数 / 开台识别
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
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
import { AdjustMemberCardTimesDto } from './dto/adjust-member-card-times.dto';
import { IdentifyMemberCardQueryDto } from './dto/identify-member-card.query.dto';
import { MemberCardIdentifyResponseDto } from './dto/member-card-identify.response.dto';
import {
  ListMemberCardsQueryDto,
  ListMemberCardTransactionsQueryDto,
} from './dto/member-card-query.dto';
import {
  MemberCardDto,
  MemberCardsResponseDto,
  MemberCardTransactionsResponseDto,
} from './dto/member-card.response.dto';
import { MemberCardIdentifyService } from './member-card-identify.service';
import { MemberCardsWriteService } from './member-cards-write.service';
import { MemberCardsService } from './member-cards.service';

/**
 * 持卡路由挂在营销域路径下（前端契约固定为 /marketing/member-cards）。
 *
 * 路由顺序约束：静态路径段（identify）必须声明在 `:id` 之前，
 * 否则会被参数路由捕获并因 ParseIntPipe 直接 400。
 */
@ApiTags('营销中心 - 会员卡')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('marketing/member-cards')
export class MemberCardsController {
  constructor(
    private readonly memberCardsService: MemberCardsService,
    private readonly memberCardsWriteService: MemberCardsWriteService,
    private readonly memberCardIdentifyService: MemberCardIdentifyService,
  ) {}

  @Get()
  @RequirePermissions('member-card:view')
  @ApiOperation({
    summary: '持卡列表',
    description:
      '按门店分页返回持卡实例，支持卡类型 / 状态 / 关键字（顾客姓名、手机号、卡号、卡名）筛选；手机号脱敏返回',
  })
  @ApiOkResponse({ type: MemberCardsResponseDto })
  listCards(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberCardsQueryDto,
  ): Promise<MemberCardsResponseDto> {
    return this.memberCardsService.listCards(user, query);
  }

  // 权限归属：本接口服务于开台 / 结账的会员资产识别，属会员卡域的只读能力，
  // 因此用 member-card:view（店长 / 收银员子账号均持有），不能退化成 marketing:view——
  // 后者覆盖整个营销中心（全量顾客列表 / 消费明细 / 营销活动），会把收银员的权限放大到营销域。
  @Get('identify')
  @RequirePermissions('member-card:view')
  @ApiOperation({
    summary: '开台识别会员资产',
    description:
      '按当前门店 + 手机号精确匹配营销顾客，返回顾客信息、储值余额、可用持卡与可用团购券；手机号脱敏返回，不返回消费明细。所需权限：member-card:view',
  })
  @ApiOkResponse({ type: MemberCardIdentifyResponseDto })
  identifyMember(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: IdentifyMemberCardQueryDto,
  ): Promise<MemberCardIdentifyResponseDto> {
    return this.memberCardIdentifyService.identify(user, query);
  }

  @Get(':id')
  @RequirePermissions('member-card:view')
  @ApiOperation({
    summary: '持卡详情',
    description: '按卡自身归属门店校验权限，返回顾客信息、次数与剩余天数',
  })
  @ApiOkResponse({ type: MemberCardDto })
  getCardDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
  ): Promise<MemberCardDto> {
    return this.memberCardsService.getCardDetail(user, id);
  }

  @Get(':id/transactions')
  @RequirePermissions('member-card:view')
  @ApiOperation({
    summary: '持卡核销流水',
    description:
      '按持卡实例分页返回追加型流水（办卡 / 预扣 / 消费 / 释放 / 调整）',
  })
  @ApiOkResponse({ type: MemberCardTransactionsResponseDto })
  listTransactions(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Query() query: ListMemberCardTransactionsQueryDto,
  ): Promise<MemberCardTransactionsResponseDto> {
    return this.memberCardsService.listTransactions(user, id, query);
  }

  @Post(':id/adjust-times')
  @RequirePermissions('member-card:manage')
  @ApiOperation({
    summary: '手动增减次数',
    description:
      '仅次数卡可调：正数增加、负数减少；条件更新防超扣，同步写 adjust 流水（备注必填）',
  })
  @ApiOkResponse({ type: MemberCardDto })
  adjustTimes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: AdjustMemberCardTimesDto,
  ): Promise<MemberCardDto> {
    return this.memberCardsWriteService.adjustTimes(user, id, dto);
  }
}
