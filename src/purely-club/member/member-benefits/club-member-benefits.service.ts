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
    const resolution = await this.clubMemberLevelsService.resolveLevelResolution(
      snapshot,
    );
    const currentLevel = resolution.currentLevelConfig.level;
    const levelConfigs = resolution.visibleLevelConfigs;

    return {
      currentLevel,
      currentLevelLabel: resolution.currentLevelConfig.label,
      items: levelConfigs.map((config) => ({
        level: config.level,
        label: config.label,
        discountRate: config.discountRate,
        benefits: [...config.benefits],
        unlocked: this.isLevelUnlocked(currentLevel, config.level),
      })),
      heldLevel: resolution.heldLevel,
      heldLevelLabel: resolution.heldLevelLabel,
      heldLevelVisible: resolution.heldLevelVisible,
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
      gold: 1,
      platinum: 2,
      diamond: 3,
    };
    return rankMap[level];
  }
}
