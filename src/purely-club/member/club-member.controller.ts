import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubMemberService } from './club-member.service';
import {
  ClubMemberAccountDto,
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
} from './dto/club-member-account.dto';

@ApiTags('Club / Member')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/member')
export class ClubMemberController {
  constructor(private readonly clubMemberService: ClubMemberService) {}

  @Get('account')
  @ApiOperation({
    summary: '获取 purely-club 当前门店会员账户基础信息',
    description:
      '返回当前登录 purely-club 用户在当前门店下的余额、积分、会员码、等级、入会时间与累计消费金额。',
  })
  @ApiOkResponse({ type: ClubMemberAccountDto })
  getAccount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClubMemberAccountDto> {
    return this.clubMemberService.getAccount(user);
  }

  @Get('level-status')
  @ApiOperation({
    summary: '获取 purely-club 当前会员等级状态',
    description:
      '返回当前等级、下一等级、升级差额与升级进度，用于首页升级提示与 memberLevel 页面状态卡片。',
  })
  @ApiOkResponse({ type: ClubMemberLevelStatusDto })
  getLevelStatus(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClubMemberLevelStatusDto> {
    return this.clubMemberService.getLevelStatus(user);
  }

  @Get('levels')
  @ApiOperation({
    summary: '获取 purely-club 会员等级配置列表',
    description:
      '返回 purely-club 前端展示所需的会员等级配置，包括颜色、背景色、升级门槛、折扣率与权益列表。',
  })
  @ApiOkResponse({ type: [ClubMemberLevelConfigDto] })
  getLevels(): Promise<ClubMemberLevelConfigDto[]> {
    return this.clubMemberService.getLevels();
  }
}
