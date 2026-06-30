import { CurrentUser } from '../../auth/current-user.decorator';
import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { BlockSubAccount } from '../../access-control/decorators/block-sub-account.decorator';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  ApplyPlatformPartnerDto,
  CreatePlatformPartnerFollowUpNoteDto,
  PreviewPlatformMembershipOrderDto,
  PurchasePlatformMembershipOrderDto,
  RejectPlatformPartnerApplicationDto,
} from './dto/platform-membership-query.dto';
import {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPlanRulesResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PreviewPlatformMembershipOrderResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from './dto/platform-membership-response.dto';
import { PlatformMembershipService } from './platform-membership.service';

@ApiTags('PlatformMembership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard, SubAccountBlockGuard)
@BlockSubAccount('子账号无权访问平台会员中心')
@Controller('platform-membership')
export class PlatformMembershipController {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
  ) {}

  @Get('center')
  @ApiOperation({ summary: '获取会员中心首页聚合数据' })
  @ApiOkResponse({
    description:
      '返回 memberCenter 页面所需的会员状态、权益统计、合伙人状态和纯利豆摘要',
    type: PlatformMembershipCenterResponseDto,
  })
  getCenter(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.platformMembershipService.getCenter(user);
  }

  @Get('profile')
  @ApiOperation({ summary: '获取会员中心头部信息' })
  @ApiOkResponse({
    description: '返回会员状态、邀请码、积分和当前可用纯利豆摘要',
    type: PlatformMembershipProfileResponseDto,
  })
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipProfileResponseDto> {
    return this.platformMembershipService.getProfile(user);
  }

  @Get('plans')
  @ApiOperation({ summary: '获取会员套餐列表' })
  @ApiOkResponse({
    description: '返回前端 memberPlans 页面所需的套餐列表',
    type: [PlatformMembershipPlanResponseDto],
  })
  listPlans(): Promise<PlatformMembershipPlanResponseDto[]> {
    return this.platformMembershipService.listPlans();
  }

  @Get('rules')
  @ApiOperation({ summary: '获取会员套餐对比规则' })
  @ApiOkResponse({
    description: '返回前端 memberPlans 页面所需的套餐对比规则表',
    type: PlatformMembershipPlanRulesResponseDto,
  })
  listPlanRules(): PlatformMembershipPlanRulesResponseDto {
    return this.platformMembershipService.listPlanRules();
  }

  @Get('orders/preview')
  @ApiOperation({ summary: '预览订单支付金额（不创建订单）' })
  @ApiOkResponse({
    description: '返回积分/纯利豆抵扣计算结果，前端仅做展示',
    type: PreviewPlatformMembershipOrderResponseDto,
  })
  previewOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Query() dto: PreviewPlatformMembershipOrderDto,
  ): Promise<PreviewPlatformMembershipOrderResponseDto> {
    return this.platformMembershipService.previewOrder(user, dto);
  }

  @Get('orders')
  @ApiOperation({ summary: '获取充值记录列表与汇总' })
  @ApiOkResponse({
    description: '返回 memberOrders 页面所需的订单列表和汇总信息',
    type: PlatformMembershipOrdersResponseDto,
  })
  listOrders(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.platformMembershipService.listOrders(user);
  }

  @Post('orders')
  @ApiOperation({ summary: '开通或续费会员并创建充值订单' })
  @ApiCreatedResponse({
    description: '创建订单成功，并返回最新会员信息与充值汇总',
    type: PurchasePlatformMembershipOrderResponseDto,
  })
  purchaseOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.platformMembershipService.purchaseOrder(user, dto);
  }

  @Get('points/logs')
  @ApiOperation({ summary: '获取平台会员积分明细' })
  @ApiOkResponse({
    description: '返回 pointsCenter 页面所需的积分汇总和明细列表',
    type: PlatformMembershipPointsLogsResponseDto,
  })
  listPointsLogs(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.platformMembershipService.listPointsLogs(user);
  }

  @Get('beans/logs')
  @ApiOperation({ summary: '获取平台会员纯利豆明细' })
  @ApiOkResponse({
    description: '返回 beanCenter 页面所需的纯利豆汇总和明细列表',
    type: PlatformMembershipBeanLogsResponseDto,
  })
  listBeanLogs(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.platformMembershipService.listBeanLogs(user);
  }

  @Get('promo')
  @ApiOperation({ summary: '获取推广中心数据' })
  @ApiOkResponse({
    description:
      '返回 promotionCenter 页面所需的推广码、等级摘要、统计和记录列表',
    type: PlatformMembershipPromoCenterResponseDto,
  })
  getPromoCenter(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.platformMembershipService.getPromoCenter(user);
  }

  @Get('partner/profile')
  @RequirePermissions('partner:view')
  @ApiOperation({ summary: '获取合伙人计划数据' })
  @ApiOkResponse({
    description:
      '返回 partnerManagement 和 partnerLevel 页面所需的申请、合伙人摘要和等级数据',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  getPartnerProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.getPartnerProfile(user);
  }

  @Post('partner/apply')
  @ApiOperation({ summary: '提交合伙人申请' })
  @ApiCreatedResponse({
    description: '提交成功后返回最新的合伙人申请与等级摘要',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  applyPartner(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.applyPartner(user, dto);
  }

  @Patch('partner/applications/:id/reviewing')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '将合伙人申请标记为审核中' })
  @ApiOkResponse({
    description: '更新申请状态后返回最新的合伙人档案与申请历史',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  markPartnerApplicationReviewing(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.markPartnerApplicationReviewing(
      user,
      applicationId,
    );
  }

  @Patch('partner/applications/:id/approve')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '审核通过合伙人申请' })
  @ApiOkResponse({
    description: '审核通过后返回最新的合伙人档案与申请历史',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  approvePartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.approvePartnerApplication(
      user,
      applicationId,
    );
  }

  @Patch('partner/applications/:id/reject')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '驳回合伙人申请' })
  @ApiOkResponse({
    description: '驳回后返回最新的合伙人档案与申请历史',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  rejectPartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: RejectPlatformPartnerApplicationDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.rejectPartnerApplication(
      user,
      applicationId,
      dto,
    );
  }

  @Patch('partner/applications/:id/cancel')
  @ApiOperation({ summary: '取消合伙人申请' })
  @ApiOkResponse({
    description: '取消后返回最新的合伙人档案与申请历史',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  cancelPartnerApplication(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.cancelPartnerApplication(
      user,
      applicationId,
    );
  }

  @Post('partner/applications/:id/follow-up-notes')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '新增合伙人申请跟进备注' })
  @ApiCreatedResponse({
    description: '新增备注后返回最新的合伙人档案与申请历史',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  addPartnerFollowUpNote(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: CreatePlatformPartnerFollowUpNoteDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.addPartnerFollowUpNote(
      user,
      applicationId,
      dto,
    );
  }
}
