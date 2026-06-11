import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  type ClubMemberAccountDto,
  type ClubMemberLevelConfigDto,
  type ClubMemberLevelStatusDto,
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
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
    private readonly clubMemberBenefitsService: ClubMemberBenefitsService,
    private readonly clubMemberTransactionsService: ClubMemberTransactionsService,
  ) {}

  async getAccount(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberAccountDto> {
    const snapshot =
      await this.clubMemberProfileService.getCurrentSnapshot(currentContext);
    return this.toAccountDto(snapshot);
  }

  async getLevelStatus(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberLevelStatusDto> {
    const snapshot =
      await this.clubMemberProfileService.getCurrentSnapshot(currentContext);
    return this.clubMemberLevelsService.buildLevelStatus(snapshot);
  }

  getLevels(): ClubMemberLevelConfigDto[] {
    return this.clubMemberLevelsService.listConfigs();
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

  private toAccountDto(snapshot: ClubMemberSnapshot): ClubMemberAccountDto {
    return {
      id: String(snapshot.memberId),
      storeId: String(snapshot.storeId),
      balance: snapshot.balance,
      level: snapshot.level,
      points: snapshot.points,
      memberCode: snapshot.memberCode,
      joinDate: snapshot.joinDate,
      totalConsume: snapshot.totalConsume,
    };
  }
}
