import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiCreatedResponse,
  ApiExcludeController,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  ApplyPlatformPartnerDto,
  CreatePlatformPartnerFollowUpNoteDto,
  PurchasePlatformMembershipOrderDto,
  RejectPlatformPartnerApplicationDto,
} from './dto/platform-membership-query.dto';
import {
  PlatformMembershipBeanLogsResponseDto,
  PlatformMembershipCenterResponseDto,
  PlatformMembershipPartnerProfileResponseDto,
  PlatformMembershipPlanResponseDto,
  PlatformMembershipPlanRulesResponseDto,
  PlatformMembershipPointsLogsResponseDto,
  PlatformMembershipProfileResponseDto,
  PlatformMembershipPromoCenterResponseDto,
  PlatformMembershipOrdersResponseDto,
  PurchasePlatformMembershipOrderResponseDto,
} from './dto/platform-membership-response.dto';
import {
  type PromotionDetailCompatResponse,
  PlatformMembershipService,
} from './platform-membership.service';

type PartnerReviewCompatStatus = 'pending' | 'approved' | 'rejected';

interface PartnerReviewCompatItem {
  id: string;
  name: string;
  phone: string;
  city: string;
  appliedAt: number;
  reason: string;
  avatar: string;
  status: PartnerReviewCompatStatus;
}

interface PartnerReviewCompatResponse {
  applications: PartnerReviewCompatItem[];
  stats: {
    totalCount: number;
    pendingCount: number;
    approvedCount: number;
    rejectedCount: number;
  };
}

function normalizePartnerReviewStatus(
  status: PlatformMembershipPartnerProfileResponseDto['applications'][number]['status'],
): PartnerReviewCompatStatus {
  switch (status) {
    case 'approved':
      return 'approved';
    case 'rejected':
      return 'rejected';
    default:
      return 'pending';
  }
}

function resolvePartnerReviewCity(region?: string[]): string {
  if (!region || region.length === 0) {
    return '';
  }

  if (region.length >= 2) {
    return region[1] ?? region[0] ?? '';
  }

  return region[0] ?? '';
}

function buildPartnerReviewApplications(
  profile: PlatformMembershipPartnerProfileResponseDto,
): PartnerReviewCompatItem[] {
  return profile.applications.map((application) => ({
    id: application.id,
    name: application.name,
    phone: application.phone,
    city: resolvePartnerReviewCity(application.region),
    appliedAt: application.createdAt,
    reason: application.applyReason ?? '',
    avatar: application.name.slice(0, 1) || '合',
    status: normalizePartnerReviewStatus(application.status),
  }));
}

function buildPartnerReviewResponse(
  profile: PlatformMembershipPartnerProfileResponseDto,
): PartnerReviewCompatResponse {
  const applications = buildPartnerReviewApplications(profile);
  const pendingCount = applications.filter(
    (application) => application.status === 'pending',
  ).length;
  const approvedCount = applications.filter(
    (application) => application.status === 'approved',
  ).length;
  const rejectedCount = applications.filter(
    (application) => application.status === 'rejected',
  ).length;

  return {
    applications,
    stats: {
      totalCount: applications.length,
      pendingCount,
      approvedCount,
      rejectedCount,
    },
  };
}

function resolvePartnerReviewRejectReason(
  body?: Record<string, unknown>,
): string {
  const reason = body?.reason;
  if (typeof reason === 'string' && reason.trim() !== '') {
    return reason.trim();
  }

  return '审核未通过';
}

@ApiTags('PlatformMembership')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
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
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipCenterResponseDto> {
    return this.platformMembershipService.getCenter(request.user);
  }

  @Get('profile')
  @ApiOperation({ summary: '获取会员中心头部信息' })
  @ApiOkResponse({
    description: '返回会员状态、邀请码、积分和当前可用纯利豆摘要',
    type: PlatformMembershipProfileResponseDto,
  })
  getProfile(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipProfileResponseDto> {
    return this.platformMembershipService.getProfile(request.user);
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

  @Get('orders')
  @ApiOperation({ summary: '获取充值记录列表与汇总' })
  @ApiOkResponse({
    description: '返回 memberOrders 页面所需的订单列表和汇总信息',
    type: PlatformMembershipOrdersResponseDto,
  })
  listOrders(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipOrdersResponseDto> {
    return this.platformMembershipService.listOrders(request.user);
  }

  @Post('orders')
  @ApiOperation({ summary: '开通或续费会员并创建充值订单' })
  @ApiCreatedResponse({
    description: '创建订单成功，并返回最新会员信息与充值汇总',
    type: PurchasePlatformMembershipOrderResponseDto,
  })
  purchaseOrder(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: PurchasePlatformMembershipOrderDto,
  ): Promise<PurchasePlatformMembershipOrderResponseDto> {
    return this.platformMembershipService.purchaseOrder(request.user, dto);
  }

  @Get('points/logs')
  @ApiOperation({ summary: '获取平台会员积分明细' })
  @ApiOkResponse({
    description: '返回 pointsCenter 页面所需的积分汇总和明细列表',
    type: PlatformMembershipPointsLogsResponseDto,
  })
  listPointsLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPointsLogsResponseDto> {
    return this.platformMembershipService.listPointsLogs(request.user);
  }

  @Get('beans/logs')
  @ApiOperation({ summary: '获取平台会员纯利豆明细' })
  @ApiOkResponse({
    description: '返回 beanCenter 页面所需的纯利豆汇总和明细列表',
    type: PlatformMembershipBeanLogsResponseDto,
  })
  listBeanLogs(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipBeanLogsResponseDto> {
    return this.platformMembershipService.listBeanLogs(request.user);
  }

  @Get('promo')
  @ApiOperation({ summary: '获取推广中心数据' })
  @ApiOkResponse({
    description:
      '返回 promotionCenter 页面所需的推广码、等级摘要、统计和记录列表',
    type: PlatformMembershipPromoCenterResponseDto,
  })
  getPromoCenter(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPromoCenterResponseDto> {
    return this.platformMembershipService.getPromoCenter(request.user);
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
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.getPartnerProfile(request.user);
  }

  @Post('partner/apply')
  @ApiOperation({ summary: '提交合伙人申请' })
  @ApiCreatedResponse({
    description: '提交成功后返回最新的合伙人申请与等级摘要',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  applyPartner(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ApplyPlatformPartnerDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.applyPartner(request.user, dto);
  }

  @Patch('partner/applications/:id/reviewing')
  @RequirePermissions('partner:review')
  @ApiOperation({ summary: '将合伙人申请标记为审核中' })
  @ApiOkResponse({
    description: '更新申请状态后返回最新的合伙人档案与申请历史',
    type: PlatformMembershipPartnerProfileResponseDto,
  })
  markPartnerApplicationReviewing(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.markPartnerApplicationReviewing(
      request.user,
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
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.approvePartnerApplication(
      request.user,
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
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: RejectPlatformPartnerApplicationDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.rejectPartnerApplication(
      request.user,
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
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.cancelPartnerApplication(
      request.user,
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
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() dto: CreatePlatformPartnerFollowUpNoteDto,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.addPartnerFollowUpNote(
      request.user,
      applicationId,
      dto,
    );
  }
}

@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('promotion-detail')
export class PromotionDetailCompatController {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
  ) {}

  @Get()
  @RequirePermissions('members:view')
  getDetail(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: Record<string, unknown>,
  ): Promise<PromotionDetailCompatResponse> {
    return this.platformMembershipService.getPromotionDetailCompat(
      request.user,
      query,
    );
  }
}

@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('partner-review')
export class PartnerReviewController {
  constructor(
    private readonly platformMembershipService: PlatformMembershipService,
  ) {}

  @Get()
  @RequirePermissions('partner:review')
  async list(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<PartnerReviewCompatResponse> {
    const profile = await this.platformMembershipService.getPartnerProfile(
      request.user,
    );
    return buildPartnerReviewResponse(profile);
  }

  @Post(':id/approve')
  @RequirePermissions('partner:review')
  approve(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.approvePartnerApplication(
      request.user,
      applicationId,
    );
  }

  @Post(':id/reject')
  @RequirePermissions('partner:review')
  reject(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) applicationId: number,
    @Body() body?: Record<string, unknown>,
  ): Promise<PlatformMembershipPartnerProfileResponseDto> {
    return this.platformMembershipService.rejectPartnerApplication(
      request.user,
      applicationId,
      { reason: resolvePartnerReviewRejectReason(body) },
    );
  }
}
