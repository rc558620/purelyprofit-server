import {
  Body,
  Controller,
  Delete,
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
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { RequirePermissions } from '../../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  CreateHandoverAdditionalItemDto,
  HandoverAdditionalItemDto,
  HandoverAdditionalItemListResponseDto,
  UpdateHandoverAdditionalItemDto,
} from './dto/handover-additional-items.dto';
import {
  ConfirmHandoverRequestDto,
  HandoverPageQueryDto,
  HandoverPageResponseDto,
} from './dto/handover-page.dto';
import {
  CancelHandoverRecordDto,
  CompleteHandoverRecordDto,
  CreateHandoverRecordDto,
  HandoverCandidateDto,
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
  HandoverRecordSummaryListResponseDto,
  HandoverRecordSummaryQueryDto,
} from './dto/handover-records.dto';

import { HandoverService } from './handover.service';

@ApiTags('Handover')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller()
export class HandoverController {
  constructor(private readonly handoverService: HandoverService) {}

  @Get('handover/page')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取 purely-profit 员工交班页面数据' })
  @ApiOkResponse({
    description: '返回交班页面展示所需的聚合数据',
    type: HandoverPageResponseDto,
  })
  getPage(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: HandoverPageQueryDto,
  ): Promise<HandoverPageResponseDto> {
    return this.handoverService.getHandoverPage(request.user, query);
  }

  @Post('handover/confirm')
  @RequirePermissions('handover:create')
  @ApiOperation({ summary: '确认 purely-profit 员工交班' })
  @ApiCreatedResponse({
    description: '交班确认成功并生成交班记录',
    type: HandoverRecordListItemDto,
  })
  confirm(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: ConfirmHandoverRequestDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverService.confirmHandover(request.user, dto);
  }

  @Get('handover-additional-items')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取 purely-profit 交班附加项列表' })
  @ApiOkResponse({
    description: '返回交班附加项列表',
    type: HandoverAdditionalItemListResponseDto,
  })
  listAdditionalItems(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<HandoverAdditionalItemListResponseDto> {
    return this.handoverService.listAdditionalItems(request.user);
  }

  @Post('handover-additional-items')
  @RequirePermissions('handover:create')
  @ApiOperation({ summary: '新增 purely-profit 交班附加项' })
  @ApiCreatedResponse({
    description: '交班附加项创建成功',
    type: HandoverAdditionalItemDto,
  })
  createAdditionalItem(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    return this.handoverService.createAdditionalItem(request.user, dto);
  }

  @Patch('handover-additional-items/:id')
  @RequirePermissions('handover:update')
  @ApiOperation({ summary: '更新 purely-profit 交班附加项' })
  @ApiOkResponse({
    description: '交班附加项更新成功',
    type: HandoverAdditionalItemDto,
  })
  updateAdditionalItem(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: UpdateHandoverAdditionalItemDto,
  ): Promise<HandoverAdditionalItemDto> {
    return this.handoverService.updateAdditionalItem(request.user, id, dto);
  }

  @Delete('handover-additional-items/:id')
  @RequirePermissions('handover:update')
  @ApiOperation({ summary: '删除 purely-profit 交班附加项' })
  @ApiOkResponse({
    description: '交班附加项删除成功',
    type: Boolean,
  })
  async deleteAdditionalItem(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<boolean> {
    await this.handoverService.deleteAdditionalItem(request.user, id);
    return true;
  }

  @Post('handover')
  @RequirePermissions('handover:create')
  @ApiOperation({ summary: '创建 purely-profit 交班记录' })
  @ApiCreatedResponse({
    description: '交班记录创建成功',
    type: HandoverRecordListItemDto,
  })
  create(
    @Req() request: { user: AuthenticatedUser },
    @Body() dto: CreateHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverService.createHandoverRecord(request.user, dto);
  }

  @Post('handover/:id/complete')
  @RequirePermissions('handover:update')
  @ApiOperation({ summary: '完成 purely-profit 交班记录' })
  @ApiOkResponse({
    description: '交班记录已完成',
    type: HandoverRecordListItemDto,
  })
  complete(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CompleteHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverService.completeHandoverRecord(request.user, id, dto);
  }

  @Post('handover/:id/cancel')
  @RequirePermissions('handover:update')
  @ApiOperation({ summary: '取消 purely-profit 交班记录' })
  @ApiOkResponse({
    description: '交班记录已取消',
    type: HandoverRecordListItemDto,
  })
  cancel(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
    @Body() dto: CancelHandoverRecordDto,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverService.cancelHandoverRecord(request.user, id, dto);
  }

  @Get('handover')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取 purely-profit 交班记录列表' })
  @ApiOkResponse({
    description: '返回交班记录列表',
    type: HandoverRecordListResponseDto,
  })
  list(
    @Req() request: { user: AuthenticatedUser },
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
    @Query('offset', new ParseIntPipe({ optional: true })) offset = 0,
  ): Promise<HandoverRecordListResponseDto> {
    return this.handoverService.listHandoverRecords(
      request.user,
      limit,
      offset,
    );
  }

  @Get('handover/records-summary')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取 purely-profit 交班记录弹窗摘要列表' })
  @ApiOkResponse({
    description: '返回交班记录弹窗所需的摘要列表',
    type: HandoverRecordSummaryListResponseDto,
  })
  listRecordSummaries(
    @Req() request: { user: AuthenticatedUser },
    @Query() query: HandoverRecordSummaryQueryDto,
  ): Promise<HandoverRecordSummaryListResponseDto> {
    return this.handoverService.listHandoverRecordSummaries(
      request.user,
      query,
    );
  }

  @Get('handover/my-pending')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取当前用户待处理的交班记录' })
  @ApiOkResponse({
    description: '返回待处理的交班记录，无则返回 null',
    type: HandoverRecordListItemDto,
  })
  getMyPending(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<HandoverRecordListItemDto | null> {
    return this.handoverService.getMyPendingHandover(request.user);
  }

  @Get('handover/candidates')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取可交班的候选人列表' })
  @ApiOkResponse({
    description: '返回可交班的候选人列表',
    type: [HandoverCandidateDto],
  })
  getCandidates(
    @Req() request: { user: AuthenticatedUser },
  ): Promise<HandoverCandidateDto[]> {
    const storeId = request.user.currentMembership?.storeId;
    if (!storeId) {
      return Promise.resolve([]);
    }
    return this.handoverService.getHandoverCandidates(storeId);
  }

  @Get('handover/:id')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取单条 purely-profit 交班记录详情' })
  @ApiOkResponse({
    description: '返回交班记录详情',
    type: HandoverRecordListItemDto,
  })
  getOne(
    @Req() request: { user: AuthenticatedUser },
    @Param('id', ParseIntPipe) id: number,
  ): Promise<HandoverRecordListItemDto> {
    return this.handoverService.getHandoverRecord(request.user, id);
  }
}
