import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
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
} from '../access-control/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../access-control/guards/permissions.guard';
import { CurrentUser } from '../auth/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import {
  CreateMarketingInviteQrIssueDto,
  ListMarketingInviteQrIssuesQueryDto,
  MarketingInviteQrIssueDto,
} from './dto/marketing-invite-code-issue.dto';
import { MarketingInviteQrIssueService } from './marketing-invite-qr-issue.service';

@ApiTags('营销中心')
@ApiBearerAuth()
@AllowLegacyOwnerAccess()
@UseGuards(JwtAuthGuard, PermissionsGuard)
@Controller('marketing')
export class MarketingInviteQrIssueController {
  constructor(
    private readonly inviteQrIssueService: MarketingInviteQrIssueService,
  ) {}

  @Get('invite-code/issues')
  @RequirePermissions('marketing:view')
  @ApiOperation({ summary: '渠道二维码发行记录列表（按渠道/状态筛选，分页）' })
  @ApiOkResponse({ type: MarketingInviteQrIssueDto, isArray: true })
  listIssues(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId: number | undefined,
    @Query() query: ListMarketingInviteQrIssuesQueryDto,
  ): Promise<{ items: MarketingInviteQrIssueDto[]; total: number }> {
    return this.inviteQrIssueService.listIssues(user, storeId, query);
  }

  @Post('invite-code/issues')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '创建渠道二维码（海报/桌牌/员工/其他）' })
  @ApiCreatedResponse({ type: MarketingInviteQrIssueDto })
  createIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId: number | undefined,
    @Body() dto: CreateMarketingInviteQrIssueDto,
  ): Promise<MarketingInviteQrIssueDto> {
    return this.inviteQrIssueService.createIssue(user, storeId, dto);
  }

  @Post('invite-code/issues/:id/revoke')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '撤销单张渠道二维码（不影响其他渠道二维码与通用二维码）' })
  @ApiOkResponse({ description: '撤销成功' })
  revokeIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId: number | undefined,
    @Param('id', new ParseIntPipe()) issueId: number,
  ): Promise<void> {
    return this.inviteQrIssueService.revokeIssue(user, storeId, issueId);
  }

  @Delete('invite-code/issues/:id')
  @RequirePermissions('marketing:manage')
  @ApiOperation({ summary: '删除单张渠道二维码（物理删除，不可恢复）' })
  @ApiOkResponse({ description: '删除成功' })
  deleteIssue(
    @CurrentUser() user: AuthenticatedUser,
    @Query('storeId', new ParseIntPipe({ optional: true })) storeId: number | undefined,
    @Param('id', new ParseIntPipe()) issueId: number,
  ): Promise<void> {
    return this.inviteQrIssueService.deleteIssue(user, storeId, issueId);
  }
}
