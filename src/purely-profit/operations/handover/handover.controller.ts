import {
  Body,
  Controller,
  Get,
  Param,
  ParseIntPipe,
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
  CancelHandoverRecordDto,
  CompleteHandoverRecordDto,
  CreateHandoverRecordDto,
  HandoverCandidateDto,
  HandoverRecordListItemDto,
  HandoverRecordListResponseDto,
} from './dto/handover.dto';
import { HandoverService } from './handover.service';

@ApiTags('Handover')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('handover')
export class HandoverController {
  constructor(private readonly handoverService: HandoverService) {}

  @Post()
  @RequirePermissions('handover:create')
  @ApiOperation({ summary: '创建交班记录' })
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

  @Post(':id/complete')
  @RequirePermissions('handover:update')
  @ApiOperation({ summary: '完成交班记录' })
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

  @Post(':id/cancel')
  @RequirePermissions('handover:update')
  @ApiOperation({ summary: '取消交班记录' })
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

  @Get()
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取交班记录列表' })
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

  @Get('my-pending')
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

  @Get('candidates')
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

  @Get(':id')
  @RequirePermissions('handover:view')
  @ApiOperation({ summary: '获取单条交班记录详情' })
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
