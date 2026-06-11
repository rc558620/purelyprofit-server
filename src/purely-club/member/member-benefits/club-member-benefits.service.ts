import { Injectable } from '@nestjs/common';
import type { ClubCurrentContext } from '../../stores/club-stores.types';
import type { ClubMemberLevelValue } from '../dto/club-member-account.dto';
import { ClubMemberLevelsService } from '../member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../member-profile/club-member-profile.service';
import type { ClubMemberBenefitsDto } from './dto/club-member-benefit.dto';

@Injectable()
export class ClubMemberBenefitsService {
  constructor(
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  async getBenefits(
    currentContext: ClubCurrentContext,
  ): Promise<ClubMemberBenefitsDto> {
    const snapshot =
      await this.clubMemberProfileService.getCurrentSnapshot(currentContext);
    const levelConfigs = this.clubMemberLevelsService.listConfigs();
    const currentLevelConfig =
      levelConfigs.find((config) => config.level === snapshot.level) ??
      levelConfigs[0];

    return {
      currentLevel: snapshot.level,
      currentLevelLabel: currentLevelConfig.label,
      items: levelConfigs.map((config) => ({
        level: config.level,
        label: config.label,
        discountRate: config.discountRate,
        benefits: [...config.benefits],
        unlocked: this.isLevelUnlocked(snapshot.level, config.level),
      })),
    };
  }

  private isLevelUnlocked(
    currentLevel: ClubMemberLevelValue,
    targetLevel: ClubMemberLevelValue,
  ): boolean {
    return this.getLevelRank(currentLevel) >= this.getLevelRank(targetLevel);
  }

  private getLevelRank(level: ClubMemberLevelValue): number {
    const rankMap: Record<ClubMemberLevelValue, number> = {
      bronze: 1,
      silver: 2,
      gold: 3,
      platinum: 4,
      diamond: 5,
    };
    return rankMap[level];
  }
}
