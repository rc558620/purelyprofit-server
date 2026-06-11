import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type {
  ClubMemberLevelConfigDto,
  ClubMemberLevelStatusDto,
  ClubMemberLevelValue,
} from '../dto/club-member-account.dto';
import type { ClubMemberSnapshot } from '../member-profile/club-member-profile.service';

const CLUB_MEMBER_LEVEL_CONFIGS: ClubMemberLevelConfigDto[] = [
  {
    level: 'bronze',
    label: '普通会员',
    color: '#8c613c',
    bgColor: '#f7ede4',
    requiredConsume: 0,
    discountRate: 0.95,
    benefits: ['9.5 折会员专属价', '基础预约通道', '生日问候礼包'],
  },
  {
    level: 'silver',
    label: '白银会员',
    color: '#7b8794',
    bgColor: '#eef2f6',
    requiredConsume: 1000,
    discountRate: 0.92,
    benefits: ['9.2 折会员专属价', '每月护理券 1 张', '节日专属礼遇'],
  },
  {
    level: 'gold',
    label: '黄金会员',
    color: '#b7862f',
    bgColor: '#fbf3df',
    requiredConsume: 3000,
    discountRate: 0.9,
    benefits: [
      '9 折会员专属价',
      '每月免费项目 2 次',
      '专属客服顾问',
      '生日礼品券 ¥100',
      '优先预约通道',
      '节日专属礼包',
    ],
  },
  {
    level: 'platinum',
    label: '铂金会员',
    color: '#5b6fa8',
    bgColor: '#eef2ff',
    requiredConsume: 5000,
    discountRate: 0.85,
    benefits: [
      '8.5 折会员专属价',
      '无限次免费项目',
      '一对一专属顾问',
      '生日礼品券 ¥200',
      'VIP 专属包厢',
      '节日专属礼包',
      '年度护理方案定制',
    ],
  },
  {
    level: 'diamond',
    label: '钻石会员',
    color: '#9f67d4',
    bgColor: '#f5f0ff',
    requiredConsume: 10000,
    discountRate: 0.8,
    benefits: [
      '8 折会员专属价',
      '全项目无限次免费',
      '私人顾问 24h 服务',
      '生日礼品券 ¥500',
      'VIP 专属套间',
      '年度护理方案定制',
      '专属限定福利礼盒',
      '节假日优先预约保障',
    ],
  },
];

@Injectable()
export class ClubMemberLevelsService {
  listConfigs(): ClubMemberLevelConfigDto[] {
    return CLUB_MEMBER_LEVEL_CONFIGS.map((config) => ({
      ...config,
      benefits: [...config.benefits],
    }));
  }

  buildLevelStatus(snapshot: ClubMemberSnapshot): ClubMemberLevelStatusDto {
    const currentLevelConfig = this.findLevelConfig(snapshot.level);
    const nextLevelConfig = CLUB_MEMBER_LEVEL_CONFIGS.find(
      (config) => config.requiredConsume > snapshot.totalConsume,
    );

    if (!nextLevelConfig) {
      return {
        currentLevel: snapshot.level,
        currentLevelLabel: currentLevelConfig.label,
        currentRequiredConsume: currentLevelConfig.requiredConsume,
        totalConsume: snapshot.totalConsume,
        nextLevel: null,
        nextLevelLabel: null,
        nextRequiredConsume: null,
        amountToNextLevel: 0,
        progressPct: 100,
        isTopLevel: true,
      };
    }

    return {
      currentLevel: snapshot.level,
      currentLevelLabel: currentLevelConfig.label,
      currentRequiredConsume: currentLevelConfig.requiredConsume,
      totalConsume: snapshot.totalConsume,
      nextLevel: nextLevelConfig.level,
      nextLevelLabel: nextLevelConfig.label,
      nextRequiredConsume: nextLevelConfig.requiredConsume,
      amountToNextLevel: this.calculateAmountToNextLevel(
        snapshot.totalConsume,
        nextLevelConfig.requiredConsume,
      ),
      progressPct: this.calculateProgressPct(
        snapshot.totalConsume,
        nextLevelConfig.requiredConsume,
      ),
      isTopLevel: false,
    };
  }

  private findLevelConfig(
    level: ClubMemberLevelValue,
  ): ClubMemberLevelConfigDto {
    return (
      CLUB_MEMBER_LEVEL_CONFIGS.find((config) => config.level === level) ??
      CLUB_MEMBER_LEVEL_CONFIGS[0]
    );
  }

  private calculateAmountToNextLevel(
    totalConsume: number,
    nextRequiredConsume: number,
  ): number {
    return Decimal.max(0, new Decimal(nextRequiredConsume).minus(totalConsume))
      .toDecimalPlaces(2)
      .toNumber();
  }

  private calculateProgressPct(
    totalConsume: number,
    nextRequiredConsume: number,
  ): number {
    if (nextRequiredConsume <= 0) {
      return 100;
    }

    return Decimal.min(
      100,
      new Decimal(totalConsume)
        .div(nextRequiredConsume)
        .mul(100)
        .toDecimalPlaces(2),
    ).toNumber();
  }
}
