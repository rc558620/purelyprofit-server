import {
  Controller,
  Get,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubMemberService } from './club-member.service';
import {
  ClubMemberAccountDto,
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
} from './dto/club-member-account.dto';
import { ClubMemberBenefitsDto } from './member-benefits/dto/club-member-benefit.dto';
import {
  ClubMemberTransactionsResponseDto,
  ListClubMemberTransactionsQueryDto,
} from './member-transactions/dto/club-member-transaction.dto';

@ApiTags('Club / Member')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@UseInterceptors(ClubCurrentContextInterceptor)
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
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubMemberAccountDto> {
    return this.clubMemberService.getAccount(currentContext);
  }

  @Get('level-status')
  @ApiOperation({
    summary: '获取 purely-club 当前会员等级状态',
    description:
      '返回当前等级、下一等级、升级差额与升级进度，用于首页升级提示与 memberLevel 页面状态卡片。',
  })
  @ApiOkResponse({ type: ClubMemberLevelStatusDto })
  getLevelStatus(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubMemberLevelStatusDto> {
    return this.clubMemberService.getLevelStatus(currentContext);
  }

  @Get('levels')
  @ApiOperation({
    summary: '获取 purely-club 会员等级配置列表',
    description:
      '返回 purely-club 前端展示所需的会员等级配置，包括颜色、背景色、升级门槛、折扣率与权益列表。',
  })
  @ApiOkResponse({ type: [ClubMemberLevelConfigDto] })
  getLevels(): ClubMemberLevelConfigDto[] {
    return this.clubMemberService.getLevels();
  }

  @Get('benefits')
  @ApiOperation({
    summary: '获取 purely-club 当前会员权益列表',
    description:
      '按会员等级返回当前 purely-club 用户可用与未解锁的权益清单，用于 memberBenefits 页面展示。',
  })
  @ApiOkResponse({ type: ClubMemberBenefitsDto })
  getBenefits(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubMemberBenefitsDto> {
    return this.clubMemberService.getBenefits(currentContext);
  }

  @Get('transactions')
  @ApiOperation({
    summary: '获取 purely-club 当前会员交易流水',
    description:
      '聚合当前 purely-club 用户在当前门店的充值、赠送、消费、退款流水，返回 memberTransactions 页面展示结构。',
  })
  @ApiOkResponse({ type: ClubMemberTransactionsResponseDto })
  listTransactions(
    @CurrentClubContext() currentContext: ClubCurrentContext,
    @Query() query: ListClubMemberTransactionsQueryDto,
  ): Promise<ClubMemberTransactionsResponseDto> {
    return this.clubMemberService.listTransactions(currentContext, query);
  }
}
