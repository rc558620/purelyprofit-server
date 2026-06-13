import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
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
import { CurrentUser } from '../../purely-profit/auth/current-user.decorator';
import { ClubJwtAuthGuard } from '../../purely-profit/auth/guards/jwt-auth.guard';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PasswordOperationResponseDto } from '../auth/dto/password-operation-response.dto';
import { ClubCurrentContextInterceptor } from '../stores/club-current-context.interceptor';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { CurrentClubContext } from '../stores/current-club-context.decorator';
import { ClubMemberService } from './club-member.service';
import {
  ChangeClubMemberPasswordDto,
  ClubMemberAccountDto,
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
  ClubMemberProfileDto,
  UpdateClubMemberAvatarDto,
  UpdateClubMemberNicknameDto,
} from './dto/club-member-account.dto';
import { ClubMemberBenefitsDto } from './member-benefits/dto/club-member-benefit.dto';
import {
  ClubMemberTransactionsResponseDto,
  ListClubMemberTransactionsQueryDto,
} from './member-transactions/dto/club-member-transaction.dto';

@ApiTags('Club / Member')
@ApiBearerAuth()
@UseGuards(ClubJwtAuthGuard)
@Controller('club/member')
export class ClubMemberController {
  constructor(private readonly clubMemberService: ClubMemberService) {}

  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: '修改当前 purely-club 账号密码',
    description:
      '仅允许当前登录 purely-club 用户修改自己的登录密码。修改成功后会刷新 token，并使旧登录态失效。',
  })
  @ApiOkResponse({
    description: '修改 purely-club 密码成功并返回新的 JWT token',
    type: PasswordOperationResponseDto,
  })
  changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangeClubMemberPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    return this.clubMemberService.changePassword(user, dto);
  }

  @Patch('profile/avatar')
  @ApiOperation({
    summary: '修改当前 purely-club 用户头像',
    description:
      '仅更新当前登录 purely-club 用户自己的头像信息，传空串表示清空头像。',
  })
  @ApiOkResponse({
    description: '更新 purely-club 用户头像成功并返回最新资料',
    type: ClubMemberProfileDto,
  })
  updateAvatar(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateClubMemberAvatarDto,
  ): Promise<ClubMemberProfileDto> {
    return this.clubMemberService.updateAvatar(user, dto);
  }

  @Patch('profile/nickname')
  @ApiOperation({
    summary: '修改当前 purely-club 用户昵称',
    description:
      '仅更新当前登录 purely-club 用户自己的昵称，不允许修改其他用户资料。',
  })
  @ApiOkResponse({
    description: '更新 purely-club 用户昵称成功并返回最新资料',
    type: ClubMemberProfileDto,
  })
  updateNickname(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: UpdateClubMemberNicknameDto,
  ): Promise<ClubMemberProfileDto> {
    return this.clubMemberService.updateNickname(user, dto);
  }

  @Get('profile')
  @ApiOperation({
    summary: '获取当前 purely-club 用户资料',
    description:
      '返回当前登录 purely-club 用户自己的基础资料，仅包含 id、手机号、昵称与头像。',
  })
  @ApiOkResponse({
    description: '获取 purely-club 当前用户资料成功',
    type: ClubMemberProfileDto,
  })
  getProfile(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<ClubMemberProfileDto> {
    return this.clubMemberService.getProfile(user);
  }

  @Get('account')
  @UseInterceptors(ClubCurrentContextInterceptor)
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
  @UseInterceptors(ClubCurrentContextInterceptor)
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
  @UseInterceptors(ClubCurrentContextInterceptor)
  @ApiOperation({
    summary: '获取 purely-club 会员等级配置列表',
    description:
      '返回当前门店的 purely-club 会员等级配置，包括颜色、背景色、升级门槛、折扣率与权益列表，仅保留黄金、铂金、钻石三级。',
  })
  @ApiOkResponse({ type: [ClubMemberLevelConfigDto] })
  getLevels(
    @CurrentClubContext() currentContext: ClubCurrentContext,
  ): Promise<ClubMemberLevelConfigDto[]> {
    return this.clubMemberService.getLevels(currentContext);
  }

  @Get('benefits')
  @UseInterceptors(ClubCurrentContextInterceptor)
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
  @UseInterceptors(ClubCurrentContextInterceptor)
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
