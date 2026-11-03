// 商家端会员卡模板接口：卡模板列表 / 新增 / 编辑 / 上下架
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
import {
  CreateMemberCardPlanDto,
  UpdateMemberCardPlanDto,
} from './dto/member-card-plan.dto';
import { ListMemberCardPlansQueryDto } from './dto/member-card-plan-query.dto';
import { ToggleMemberCardPlanDto } from './dto/member-card-plan-toggle.dto';
import {
  MemberCardPlanDto,
  MemberCardPlansResponseDto,
} from './dto/member-card-plan.response.dto';
import { MemberCardPlansService } from './member-card-plans.service';

/**
 * 会员卡模板路由挂在营销域路径下（前端契约固定为 /marketing/member-card-plans），
 * 门店归属、权限与业态校验统一由 guard + service 完成，controller 只做参数接收。
 */
@ApiTags('营销中心 - 会员卡')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard, BusinessModeGuard)
@RequireBusinessMode('general')
@Controller('marketing/member-card-plans')
export class MemberCardPlansController {
  constructor(
    private readonly memberCardPlansService: MemberCardPlansService,
  ) {}

  @Get()
  @RequirePermissions('member-card:manage')
  @ApiOperation({
    summary: '会员卡模板列表',
    description: '按门店分页返回卡模板，支持卡类型 / 上架状态 / 名称关键字筛选',
  })
  @ApiOkResponse({ type: MemberCardPlansResponseDto })
  listPlans(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberCardPlansQueryDto,
  ): Promise<MemberCardPlansResponseDto> {
    return this.memberCardPlansService.listPlans(user, query);
  }

  @Post()
  @RequirePermissions('member-card:manage')
  @ApiOperation({
    summary: '新增会员卡模板',
    description: '金额按元入参，后端转分落库；次数卡必须提供总次数',
  })
  @ApiCreatedResponse({ type: MemberCardPlanDto })
  createPlan(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', ParseIntPipe) storeId: number,
    @Body() dto: CreateMemberCardPlanDto,
  ): Promise<MemberCardPlanDto> {
    return this.memberCardPlansService.createPlan(user, storeId, dto);
  }

  @Patch(':id')
  @RequirePermissions('member-card:manage')
  @ApiOperation({
    summary: '编辑会员卡模板',
    description: '局部更新：未下发字段保持原值，显式传 null 表示清空',
  })
  @ApiOkResponse({ type: MemberCardPlanDto })
  updatePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateMemberCardPlanDto,
  ): Promise<MemberCardPlanDto> {
    return this.memberCardPlansService.updatePlan(user, id, dto);
  }

  @Patch(':id/toggle')
  @RequirePermissions('member-card:manage')
  @ApiOperation({
    summary: '会员卡模板上下架',
    description: '下架后不再对外售卖，已售出的持卡实例不受影响',
  })
  @ApiOkResponse({ type: MemberCardPlanDto })
  togglePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: ToggleMemberCardPlanDto,
  ): Promise<MemberCardPlanDto> {
    return this.memberCardPlansService.togglePlan(user, id, dto);
  }
}
