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
import { ClubMemberAccountDto } from './dto/club-member-account.dto';

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
}
