import {
  buildPartnerLevel,
  resolvePartnerLevel,
} from './platform-membership-promo-stats.domain';
import {
  buildCurrentPartnerApplication,
  buildPartnerProfileResponse,
} from './platform-membership-partner.domain';
import {
  isSameApplicant,
  normalizePartnerPhone,
} from './platform-membership-partner-application.domain';
import { buildPromotionDetailCompatResponse } from './platform-membership-promo-compat.domain';
import { PlatformMembershipReadService } from './platform-membership-read.service';
import * as query from './platform-membership.query';
import type {
  StoreMembershipProfileRecord,
  StoreMembershipPromoRecord,
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';

// 仅对 getPromoCenterByStoreId 实际用到的查询函数做 mock，
// 其余导出保持真实实现，避免破坏被测模块链路。
jest.mock('./platform-membership.query', () => {
  const actual = jest.requireActual('./platform-membership.query');
  return {
    ...actual,
    findCurrentStorePartner: jest.fn(),
    findStoreMembershipPromoRecords: jest.fn(),
    ensureMembershipProfile: jest.fn(),
    findPaidStoreMembershipOrders: jest.fn(),
    loadPlanCatalog: jest.fn(),
  };
});

const SHANGHAI_NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // 2026-07-15T12:00:00Z = 上海 20:00

function makePartner(
  overrides: Partial<StorePartnerRecord> = {},
): StorePartnerRecord {
  return {
    id: 1,
    status: 'approved',
    name: '王建国',
    phone: '13800138000',
    idCard: '44030119900101123X',
    region: [],
    intention: 'agent',
    applyReason: null,
    paymentAccountType: 'wechat',
    paymentAccountNo: 'wx_1',
    paymentAccountName: '王建国',
    beanBalance: 114,
    totalEarnedBeans: 320,
    totalWithdrawnBeans: 120,
    joinedAt: new Date(SHANGHAI_NOW),
    reviewedAt: new Date(SHANGHAI_NOW),
    createdAt: new Date(SHANGHAI_NOW),
    ...overrides,
  };
}

function makeApplication(
  overrides: Partial<StorePartnerApplicationRecord> = {},
): StorePartnerApplicationRecord {
  return {
    id: 1,
    storeId: 10,
    status: 'pending',
    name: '张三',
    phone: '13900139000',
    idCard: '44030119900202234Y',
    region: [],
    intention: 'agent',
    applyReason: null,
    paymentAccountType: 'wechat',
    paymentAccountNo: 'wx_2',
    paymentAccountName: '张三',
    reviewedAt: null,
    joinedAt: null,
    createdAt: new Date(SHANGHAI_NOW),
    followUpNotes: [],
    ...overrides,
  };
}

function makePromo(
  overrides: Partial<StoreMembershipPromoRecord> = {},
): StoreMembershipPromoRecord {
  return {
    id: 1,
    inviteeName: '李四',
    inviteePhone: '13700137000',
    registeredAt: new Date(SHANGHAI_NOW),
    hasCharged: true,
    chargedAmount: 3800,
    chargedAt: new Date(SHANGHAI_NOW),
    chargedPlan: 'monthly',
    rewardBeans: 8,
    settled: false,
    partnerId: null,
    ...overrides,
  };
}

function makeProfile(
  overrides: Partial<StoreMembershipProfileRecord> = {},
): StoreMembershipProfileRecord {
  return {
    id: 1,
    storeId: 10,
    currentPlanId: null,
    startsAt: null,
    expiresAt: null,
    totalPoints: 0,
    availablePoints: 0,
    ...overrides,
  };
}

describe('合伙人等级修复验证', () => {
  let dateNowSpy: jest.SpyInstance;

  beforeAll(() => {
    dateNowSpy = jest.spyOn(Date, 'now').mockReturnValue(SHANGHAI_NOW);
  });

  afterAll(() => {
    dateNowSpy.mockRestore();
  });

  describe('B4：非合伙人 monthCountToNextLevel 不再为 null', () => {
    it('非合伙人应返回距首档剩余人数（数字，非 null）', () => {
      const level = buildPartnerLevel(null, []);
      expect(level.partnerLevel).toBeNull();
      expect(level.monthCountToNextLevel).toBe(10); // 0 充值 -> 距 elite(10) 还差 10
      expect(level.currentLevelRewards.monthly).toBe(8); // star 奖励
    });

    it('非合伙人但本月已有 15 充值，剩余应为 0（非 null）', () => {
      const promos = Array.from({ length: 15 }, (_, i) =>
        makePromo({
          id: i + 1,
          partnerId: 1,
          chargedAt: new Date(SHANGHAI_NOW),
        }),
      );
      const level = buildPartnerLevel(null, promos);
      expect(level.monthCountToNextLevel).toBe(0);
    });
  });

  describe('等级阈值与 monthCountToNextLevel 一致性', () => {
    it('resolvePartnerLevel 阈值：>=30 legend, >=10 elite, 其余 star', () => {
      expect(resolvePartnerLevel(30)).toBe('legend');
      expect(resolvePartnerLevel(29)).toBe('elite');
      expect(resolvePartnerLevel(10)).toBe('elite');
      expect(resolvePartnerLevel(9)).toBe('star');
      expect(resolvePartnerLevel(0)).toBe('star');
    });

    it('已通过合伙人各档 monthCountToNextLevel 正确', () => {
      const partner = makePartner();
      expect(buildPartnerLevel(partner, []).monthCountToNextLevel).toBe(10); // star 距 elite
      const elite = Array.from({ length: 10 }, (_, i) =>
        makePromo({
          id: i + 1,
          partnerId: 1,
          chargedAt: new Date(SHANGHAI_NOW),
        }),
      );
      expect(buildPartnerLevel(partner, elite).partnerLevel).toBe('elite');
      expect(buildPartnerLevel(partner, elite).monthCountToNextLevel).toBe(20); // 30-10
      const legend = Array.from({ length: 30 }, (_, i) =>
        makePromo({
          id: i + 1,
          partnerId: 1,
          chargedAt: new Date(SHANGHAI_NOW),
        }),
      );
      expect(buildPartnerLevel(partner, legend).partnerLevel).toBe('legend');
      expect(
        buildPartnerLevel(partner, legend).monthCountToNextLevel,
      ).toBeNull();
    });
  });

  describe('B6：月边界使用上海时区', () => {
    it('上海 7 月内的充值计入，6 月（含跨 UTC 边界）不计入', () => {
      const partner = makePartner();
      const promos: StoreMembershipPromoRecord[] = [
        makePromo({
          id: 1,
          partnerId: 1,
          chargedAt: new Date(Date.UTC(2026, 6, 10, 0, 0, 0)),
        }), // 上海 7/10 计入
        makePromo({
          id: 2,
          partnerId: 1,
          chargedAt: new Date(Date.UTC(2026, 5, 30, 17, 0, 0)),
        }), // 上海 7/1 01:00 计入
        makePromo({
          id: 3,
          partnerId: 1,
          chargedAt: new Date(Date.UTC(2026, 5, 30, 15, 0, 0)),
        }), // 上海 6/30 23:00 不计入
        makePromo({
          id: 4,
          partnerId: 1,
          chargedAt: new Date(Date.UTC(2026, 5, 15, 0, 0, 0)),
        }), // 6 月不计入
      ];
      // 旧逻辑（服务器 UTC）会把 6/30 15:00Z 也计入（共 4 条）；上海逻辑只计 2 条
      expect(buildPartnerLevel(partner, promos).monthChargedCount).toBe(2);
    });
  });

  describe('B1：等级只统计归属该合伙人的推广记录', () => {
    it('buildPartnerProfileResponse 按 partnerId 过滤', () => {
      const partner = makePartner();
      const promos: StoreMembershipPromoRecord[] = [
        makePromo({ id: 1, partnerId: 1, chargedAt: new Date(SHANGHAI_NOW) }), // 计入
        makePromo({ id: 2, partnerId: 2, chargedAt: new Date(SHANGHAI_NOW) }), // 他人，不计入
        makePromo({
          id: 3,
          partnerId: 1,
          chargedAt: new Date(Date.UTC(2026, 5, 15, 0, 0, 0)),
        }), // 6 月，不计入
      ];
      const response = buildPartnerProfileResponse({
        partner,
        promoRecords: promos,
        applications: [],
      });
      expect(response.level.monthChargedCount).toBe(1);
    });
  });

  describe('B2：已通过合伙人无匹配申请时余额不为 0', () => {
    it('最新申请与合伙人不匹配时，currentApplication.beanBalance 取真实合伙人账户', () => {
      const partner = makePartner({ beanBalance: 114 });
      // 最新申请来自另一个人（idCard/phone 均与合伙人不同），且为 pending
      const applications = [
        makeApplication({
          id: 99,
          status: 'pending',
          idCard: '999',
          phone: '999',
        }),
      ];
      const response = buildPartnerProfileResponse({
        partner,
        promoRecords: [],
        applications,
      });
      expect(response.currentApplication).not.toBeNull();
      expect(response.currentApplication?.beanBalance).toBe(114);
      expect(response.currentApplication?.totalEarnedBeans).toBe(320);
    });
  });

  describe('B9：手机号归一化', () => {
    it('normalizePartnerPhone 去除非数字字符', () => {
      expect(normalizePartnerPhone('138-0013-8000')).toBe('13800138000');
      expect(normalizePartnerPhone('138 0013 8000')).toBe('13800138000');
      expect(normalizePartnerPhone(null)).toBe('');
    });

    it('isSameApplicant 对格式化差异的手机号判定为同一人', () => {
      const applicant = { idCard: 'X', phone: '138-0013-8000' };
      const payload = { idCard: 'X', phone: '13800138000' };
      expect(isSameApplicant(applicant, payload)).toBe(true);
    });

    it('buildCurrentPartnerApplication 按归一化手机号匹配', () => {
      const partner = makePartner({ phone: '138 0013 8000' });
      const applications = [
        makeApplication({ id: 5, status: 'approved', phone: '13800138000' }),
      ];
      const result = buildCurrentPartnerApplication(applications, partner);
      expect(result).not.toBeNull();
      expect(result?.status).toBe('approved');
    });
  });

  describe('B1 收口验证：所有 buildPartnerLevel 调用点均按 partnerId 过滤', () => {
    it('buildPartnerLevel 内部直接过滤混合合伙人记录', () => {
      const partner = makePartner({ id: 7 });
      const promos: StoreMembershipPromoRecord[] = [
        makePromo({ id: 1, partnerId: 7, chargedAt: new Date(SHANGHAI_NOW) }),
        makePromo({ id: 2, partnerId: 8, chargedAt: new Date(SHANGHAI_NOW) }), // 他人
        makePromo({
          id: 3,
          partnerId: 7,
          chargedAt: new Date(Date.UTC(2026, 5, 15, 0, 0, 0)),
        }), // 6 月
      ];
      expect(buildPartnerLevel(partner, promos).monthChargedCount).toBe(1);
      // 非合伙人不过滤（仍按全门店口径）
      expect(buildPartnerLevel(null, promos).monthChargedCount).toBe(2);
    });

    it('推广详情兼容页 level 按 partnerId 过滤', () => {
      const partner = makePartner({ id: 7 });
      const promos: StoreMembershipPromoRecord[] = [
        makePromo({ id: 1, partnerId: 7, chargedAt: new Date(SHANGHAI_NOW) }),
        makePromo({ id: 2, partnerId: 8, chargedAt: new Date(SHANGHAI_NOW) }), // 他人
      ];
      const response = buildPromotionDetailCompatResponse({
        profile: makeProfile(),
        partner,
        promoRecords: promos,
        filteredRecords: promos,
        filters: { queryMode: 'all', date: null, keyword: null },
        inviteCode: null,
      });
      expect(response.level.monthChargedCount).toBe(1);
    });

    it('推广中心页 getPromoCenterByStoreId level 按 partnerId 过滤', async () => {
      const partner = makePartner({ id: 7 });
      const promos: StoreMembershipPromoRecord[] = [
        makePromo({ id: 1, partnerId: 7, chargedAt: new Date(SHANGHAI_NOW) }),
        makePromo({ id: 2, partnerId: 8, chargedAt: new Date(SHANGHAI_NOW) }), // 他人
      ];
      (query.findCurrentStorePartner as jest.Mock).mockResolvedValue(partner);
      (query.findStoreMembershipPromoRecords as jest.Mock).mockResolvedValue(
        promos,
      );
      (query.ensureMembershipProfile as jest.Mock).mockResolvedValue(
        makeProfile(),
      );
      (query.findPaidStoreMembershipOrders as jest.Mock).mockResolvedValue([]);
      (query.loadPlanCatalog as jest.Mock).mockResolvedValue([]);
      const prismaMock = {
        storeInviteCode: { findFirst: jest.fn().mockResolvedValue(null) },
      };
      const service = new PlatformMembershipReadService(
        prismaMock as never,
        {} as never,
      );
      const response = await service.getPromoCenterByStoreId(10);
      expect(response.level.monthChargedCount).toBe(1);
    });
  });
});
