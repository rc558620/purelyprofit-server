import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
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
  ApiExcludeController,
  ApiNoContentResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { CurrentUser } from '../../auth/current-user.decorator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  AdjustMemberBeansDto,
  AdjustMemberBeansResponseDto,
  ListMemberBeansLogsQueryDto,
  MemberBeansOverviewResponseDto,
  PaginatedMemberBeansLogsResponseDto,
} from './dto/member-beans.dto';
import {
  MemberLogsOverviewQueryDto,
} from './dto/member-asset-shared.dto';
import {
  AdjustMemberPointsDto,
  AdjustMemberPointsResponseDto,
  ListMemberPointsLogsQueryDto,
  MemberPointsOverviewResponseDto,
  PaginatedMemberPointsLogsResponseDto,
} from './dto/member-points.dto';
import { CreateMemberDto } from './dto/create-member.dto';
import {
  MemberMetaQueryDto,
  MembersMetaResponseDto,
} from './dto/member-meta.dto';
import {
  MemberOverviewQueryDto,
  MembersOverviewResponseDto,
} from './dto/member-overview.dto';
import {
  ListMembersQueryDto,
  ListMemberSnapshotsQueryDto,
  MemberResponseDto,
  MemberSnapshotDto,
  PaginatedMembersResponseDto,
} from './dto/member-response.dto';
import { UpdateMemberDto } from './dto/update-member.dto';
import { MembersPointsService } from './members-points.service';
import { MembersService } from './members.service';

@ApiTags('Members')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('members')
export class MembersController {
  constructor(
    private readonly membersService: MembersService,
    private readonly membersPointsService: MembersPointsService,
  ) {}

  @Post()
  @RequirePermissions('members:create')
  @ApiOperation({ summary: '新增会员' })
  @ApiCreatedResponse({
    description: '新增成功并返回会员信息',
    type: MemberResponseDto,
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateMemberDto,
  ): Promise<MemberResponseDto> {
    return this.membersService.create(user, dto);
  }

  @Get()
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员列表' })
  @ApiOkResponse({
    description: '返回当前用户可管理的会员列表与分页信息',
    type: PaginatedMembersResponseDto,
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMembersQueryDto,
  ): Promise<PaginatedMembersResponseDto> {
    return this.membersService.list(user, query);
  }

  @Get('meta')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员筛选元数据' })
  @ApiOkResponse({
    description: '返回会员等级和状态筛选项及命中数量',
    type: MembersMetaResponseDto,
  })
  getMeta(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MemberMetaQueryDto,
  ): Promise<MembersMetaResponseDto> {
    return this.membersService.getMeta(user, query);
  }

  @Get('overview')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员概览统计' })
  @ApiOkResponse({
    description: '返回总会员、活跃、合伙人、封禁统计',
    type: MembersOverviewResponseDto,
  })
  getOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MemberOverviewQueryDto,
  ): Promise<MembersOverviewResponseDto> {
    return this.membersService.getOverview(user, query);
  }

  @Get('snapshots')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员快照列表' })
  @ApiOkResponse({
    description: '返回会员积分/纯利豆调整弹窗可用的会员快照列表',
    type: [MemberSnapshotDto],
  })
  listSnapshots(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberSnapshotsQueryDto,
  ): Promise<MemberSnapshotDto[]> {
    return this.membersService.listSnapshots(user, query);
  }

  @Get('points/overview')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员积分记录概览' })
  @ApiOkResponse({
    description: '返回积分记录总数、管理员调整数与今日变动数',
    type: MemberPointsOverviewResponseDto,
  })
  getPointsOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MemberLogsOverviewQueryDto,
  ): Promise<MemberPointsOverviewResponseDto> {
    return this.membersPointsService.getPointsOverview(user, query);
  }

  @Get('points/logs')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员积分记录列表' })
  @ApiOkResponse({
    description: '返回会员积分记录列表与分页信息',
    type: PaginatedMemberPointsLogsResponseDto,
  })
  listPointsLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    return this.membersPointsService.listPointsLogs(user, query);
  }

  @Post('points/adjust')
  @RequirePermissions('members:update')
  @ApiOperation({ summary: '调整会员积分' })
  @ApiCreatedResponse({
    description: '积分调整成功并返回最新会员信息与积分记录',
    type: AdjustMemberPointsResponseDto,
  })
  adjustPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdjustMemberPointsDto,
  ): Promise<AdjustMemberPointsResponseDto> {
    return this.membersPointsService.adjustPoints(user, dto);
  }

  @Get('beans/overview')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员纯利豆记录概览' })
  @ApiOkResponse({
    description: '返回纯利豆记录总数、管理员调整数、推广奖励数与提现数',
    type: MemberBeansOverviewResponseDto,
  })
  getBeansOverview(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: MemberLogsOverviewQueryDto,
  ): Promise<MemberBeansOverviewResponseDto> {
    return this.membersPointsService.getBeansOverview(user, query);
  }

  @Get('beans/logs')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员纯利豆记录列表' })
  @ApiOkResponse({
    description: '返回会员纯利豆记录列表与分页信息',
    type: PaginatedMemberBeansLogsResponseDto,
  })
  listBeanLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    return this.membersPointsService.listBeanLogs(user, query);
  }

  @Post('beans/adjust')
  @RequirePermissions('members:update')
  @ApiOperation({ summary: '调整会员纯利豆' })
  @ApiCreatedResponse({
    description: '纯利豆调整成功并返回最新会员信息与纯利豆记录',
    type: AdjustMemberBeansResponseDto,
  })
  adjustBeans(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdjustMemberBeansDto,
  ): Promise<AdjustMemberBeansResponseDto> {
    return this.membersPointsService.adjustBeans(user, dto);
  }

  @Get(':id/points/logs')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取指定会员积分记录列表' })
  @ApiOkResponse({
    description: '返回指定会员的积分记录列表与分页信息',
    type: PaginatedMemberPointsLogsResponseDto,
  })
  listMemberPointsLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
    @Query() query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    return this.membersPointsService.listPointsLogsForMember(
      user,
      memberId,
      query,
    );
  }

  @Post(':id/points/adjust')
  @RequirePermissions('members:update')
  @ApiOperation({ summary: '调整指定会员积分' })
  @ApiCreatedResponse({
    description: '积分调整成功并返回最新会员信息与积分记录',
    type: AdjustMemberPointsResponseDto,
  })
  adjustMemberPoints(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
    @Body() dto: AdjustMemberPointsDto,
  ): Promise<AdjustMemberPointsResponseDto> {
    return this.membersPointsService.adjustPoints(user, dto, memberId);
  }

  @Get(':id/beans/logs')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取指定会员纯利豆记录列表' })
  @ApiOkResponse({
    description: '返回指定会员的纯利豆记录列表与分页信息',
    type: PaginatedMemberBeansLogsResponseDto,
  })
  listMemberBeanLogs(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
    @Query() query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    return this.membersPointsService.listBeanLogsForMember(
      user,
      memberId,
      query,
    );
  }

  @Post(':id/beans/adjust')
  @RequirePermissions('members:update')
  @ApiOperation({ summary: '调整指定会员纯利豆' })
  @ApiCreatedResponse({
    description: '纯利豆调整成功并返回最新会员信息与纯利豆记录',
    type: AdjustMemberBeansResponseDto,
  })
  adjustMemberBeans(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
    @Body() dto: AdjustMemberBeansDto,
  ): Promise<AdjustMemberBeansResponseDto> {
    return this.membersPointsService.adjustBeans(user, dto, memberId);
  }

  @Get(':id')
  @RequirePermissions('members:view')
  @ApiOperation({ summary: '获取会员详情' })
  @ApiOkResponse({
    description: '返回指定会员详情',
    type: MemberResponseDto,
  })
  getDetail(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<MemberResponseDto> {
    return this.membersService.getDetail(user, memberId);
  }

  @Patch(':id')
  @RequirePermissions('members:update')
  @ApiOperation({ summary: '更新会员信息' })
  @ApiOkResponse({
    description: '更新成功并返回会员信息',
    type: MemberResponseDto,
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
    @Body() dto: UpdateMemberDto,
  ): Promise<MemberResponseDto> {
    return this.membersService.update(user, memberId, dto);
  }

  @Delete(':id')
  @RequirePermissions('members:update')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: '删除会员' })
  @ApiNoContentResponse({ description: '删除成功' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseIntPipe) memberId: number,
  ): Promise<void> {
    await this.membersService.remove(user, memberId);
  }
}

@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('member-points')
export class MemberPointsController {
  constructor(private readonly membersPointsService: MembersPointsService) {}

  @Get()
  @RequirePermissions('members:view')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberPointsLogsQueryDto,
  ): Promise<PaginatedMemberPointsLogsResponseDto> {
    return this.membersPointsService.listPointsLogs(user, query);
  }

  @Post('adjust')
  @RequirePermissions('members:update')
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdjustMemberPointsDto,
  ): Promise<AdjustMemberPointsResponseDto> {
    return this.membersPointsService.adjustPoints(user, dto);
  }
}

@ApiExcludeController()
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('partner-beans')
export class PartnerBeansController {
  constructor(private readonly membersPointsService: MembersPointsService) {}

  @Get()
  @RequirePermissions('members:view')
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMemberBeansLogsQueryDto,
  ): Promise<PaginatedMemberBeansLogsResponseDto> {
    return this.membersPointsService.listBeanLogs(user, query);
  }

  @Post('adjust')
  @RequirePermissions('members:update')
  adjust(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: AdjustMemberBeansDto,
  ): Promise<AdjustMemberBeansResponseDto> {
    return this.membersPointsService.adjustBeans(user, dto);
  }
}
