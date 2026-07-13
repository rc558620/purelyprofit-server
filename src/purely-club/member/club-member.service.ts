import { Injectable } from '@nestjs/common';
import { AuthService } from '../../purely-profit/auth/auth.service';
import type { ProfileUserDto } from '../../purely-profit/auth/dto/profile-response.dto';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';
import { fetchPointsRedeemConfig } from '../orders/club-order-drafts.utils';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  type ClubMemberAccountDto,
  type ClubMemberLevelConfigDto,
  type ClubMemberLevelStatusDto,
  type ClubMemberProfileDto,
  ClubPointsRatioDto,
  type UpdateClubMemberAvatarDto,
  type UpdateClubMemberNicknameDto,
} from './dto/club-member-account.dto';
import { ClubMemberBenefitsService } from './member-benefits/club-member-benefits.service';
import type { ClubMemberBenefitsDto } from './member-benefits/dto/club-member-benefit.dto';
import { ClubMemberLevelsService } from './member-levels/club-member-levels.service';
import {
  ClubMemberProfileService,
  type ClubMemberSnapshot,
} from './member-profile/club-member-profile.service';
import { ClubMemberTransactionsService } from './member-transactions/club-member-transactions.service';
import type {
  ClubMemberTransactionsResponseDto,
  ListClubMemberTransactionsQueryDto,
} from './member-transactions/dto/club-member-transaction.dto';

@Injectable()
export class ClubMemberService {
  constructor(
    private readonly authService: AuthService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
    private readonly clubMemberBenefitsService: ClubMemberBenefitsService,
    private readonly clubMemberTransactionsService: ClubMemberTransactionsService,
    private readonly prisma: PrismaService,
  ) {}

  async updateAvatar(
    user: AuthenticatedUser,
    dto: UpdateClubMemberAvatarDto,
  ): Promise<ClubMemberProfileDto> {
    const profile = await this.authService.updateAvatar(user, {
      avatar: dto.avatar,
    });
    return this.toProfileDto(profile.user);
  }

  async updateNickname(
    user: AuthenticatedUser,
    dto: UpdateClubMemberNicknameDto,
  ): Promise<ClubMemberProfileDto> {
    const profile = await this.authService.updateNickname(user, dto.nickname);
    return this.toProfileDto(profile.user);
  }

  async getProfile(user: AuthenticatedUser): Promise<ClubMemberProfileDto> {
    const profile = await this.authService.getProfile(user);
    return this.toProfileDto(profile.user);
  }

  async getAccount(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberAccountDto> {
    const snapshot =
      await this.clubMemberProfileService.getCurrentSnapshot(currentContext);
    const levelResolution =
      await this.clubMemberLevelsService.resolveLevelResolution(snapshot);
    return this.toAccountDto(snapshot, levelResolution);
  }

  async getLevelStatus(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberLevelStatusDto> {
    const snapshot =
      await this.clubMemberProfileService.getCurrentSnapshot(currentContext);
    return this.clubMemberLevelsService.buildLevelStatus(snapshot);
  }

  getLevels(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberLevelConfigDto[]> {
    return this.clubMemberLevelsService.listConfigs(currentContext.store.id);
  }

  async getPointsRatio(
    currentContext: ClubCurrentContext,
  ): Promise<ClubPointsRatioDto> {
    // 复用共享的 fetchPointsRedeemConfig，消除冗余查询。
    // ⚠️ 设计决策：返回的 enabled 字段仅供前端展示抵扣比例提示，
    //   前端不消费 enabled 来禁用积分开关（积分抵扣不受 enabled 限制）。
    //   禁止在调用侧根据 enabled=false 拦截积分抵扣功能。
    return fetchPointsRedeemConfig(this.prisma, currentContext.store.id);
  }

  async getBenefits(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberBenefitsDto> {
    return this.clubMemberBenefitsService.getBenefits(currentContext);
  }

  async listTransactions(
    currentContext: ClubCurrentContext,
    query: ListClubMemberTransactionsQueryDto,
  ): Promise<ClubMemberTransactionsResponseDto> {
    return this.clubMemberTransactionsService.list(currentContext, query);
  }

  private toProfileDto(user: ProfileUserDto): ClubMemberProfileDto {
    return {
      id: String(user.id),
      phone: user.phone,
      nickname: user.name ?? '',
      avatar: user.avatar,
    };
  }

  private toAccountDto(
    snapshot: ClubMemberSnapshot,
    levelResolution: Awaited<
      ReturnType<ClubMemberLevelsService['resolveLevelResolution']>
    >,
  ): ClubMemberAccountDto {
    return {
      id: String(snapshot.memberId),
      storeId: String(snapshot.storeId),
      balance: snapshot.balance,
      level: levelResolution.currentLevelConfig.level,
      points: snapshot.points,
      memberCode: snapshot.memberCode,
      joinDate: snapshot.joinDate,
      totalConsume: snapshot.totalConsume,
      heldLevel: levelResolution.heldLevel,
      heldLevelLabel: levelResolution.heldLevelLabel,
      heldLevelVisible: levelResolution.heldLevelVisible,
    };
  }
}
