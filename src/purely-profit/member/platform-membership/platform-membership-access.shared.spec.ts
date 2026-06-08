import { StoreSubAccountRole, StoreSubAccountStatus } from '@prisma/client';
import {
  buildMembershipRuleSnapshot,
  buildSubAccountBenefitSnapshot,
  clampHistoryRangeByWindow,
  createSubAccountRoleSnapshot,
  getHistoryWindowStartFromDays,
  getSubAccountQuotaValidationIssue,
  isMissingSubAccountQuotaSchemaError,
  normalizeSubAccountQuota,
  resolveMembershipLevel,
} from './platform-membership-access.shared';

describe('platform-membership-access.shared', () => {
  it('过期会员会降级为免费版', () => {
    expect(
      resolveMembershipLevel(
        {
          currentPlanId: 'monthly',
          startsAt: new Date('2026-04-01T00:00:00.000Z'),
          expiresAt: new Date('2026-05-01T00:00:00.000Z'),
          subAccountQuota: 0,
        },
        new Date('2026-05-23T12:00:00.000Z').getTime(),
      ),
    ).toBe('free');
  });

  it('legacy yearly 且 expiresAt 为空时识别为 lifetime', () => {
    expect(
      resolveMembershipLevel(
        {
          currentPlanId: 'yearly',
          startsAt: new Date('2026-01-01T00:00:00.000Z'),
          expiresAt: null,
          subAccountQuota: 0,
        },
        new Date('2026-05-23T12:00:00.000Z').getTime(),
      ),
    ).toBe('lifetime');
  });

  it('年度及以上会员的子账号额度会被裁剪到上限内', () => {
    expect(
      buildSubAccountBenefitSnapshot({
        currentPlanId: 'yearly',
        startsAt: new Date('2026-01-01T00:00:00.000Z'),
        expiresAt: new Date('2027-01-01T00:00:00.000Z'),
        subAccountQuota: 99,
      }),
    ).toEqual({
      level: 'yearly',
      eligible: true,
      quota: 10,
      quotaMax: 10,
      enabled: true,
      rawQuota: 99,
    });
  });

  it('非可用等级的子账号额度会被归零', () => {
    expect(normalizeSubAccountQuota(5, false)).toBe(0);
    expect(
      buildMembershipRuleSnapshot({
        currentPlanId: 'monthly',
        startsAt: new Date('2026-05-01T00:00:00.000Z'),
        expiresAt: new Date('2026-06-01T00:00:00.000Z'),
        subAccountQuota: 5,
      }).subAccountEligible,
    ).toBe(false);
  });

  it('子账号额度校验会返回明确问题类型', () => {
    expect(getSubAccountQuotaValidationIssue(1.2)).toBe('not_integer');
    expect(getSubAccountQuotaValidationIssue(99)).toBe('out_of_range');
    expect(getSubAccountQuotaValidationIssue(5)).toBeNull();
  });

  it('历史窗口会从当天向前按天数裁剪', () => {
    expect(
      getHistoryWindowStartFromDays(7, new Date('2026-05-23T12:00:00.000Z')),
    ).toBe(new Date(2026, 4, 17, 0, 0, 0, 0).getTime());
  });

  it('历史范围裁剪会处理完全落在窗口前的区间', () => {
    const historyWindowStart = new Date(2026, 4, 17, 0, 0, 0, 0).getTime();
    expect(
      clampHistoryRangeByWindow(
        {
          start: new Date(2026, 4, 1, 0, 0, 0, 0).getTime(),
          end: new Date(2026, 4, 16, 23, 59, 59, 999).getTime(),
        },
        historyWindowStart,
      ),
    ).toEqual({
      start: historyWindowStart,
      end: historyWindowStart - 1,
      clamped: true,
      empty: true,
    });
  });

  it('角色快照与 schema 错误识别都保持纯函数行为', () => {
    expect(
      createSubAccountRoleSnapshot(
        StoreSubAccountRole.manager,
        StoreSubAccountStatus.active,
        true,
        false,
      ),
    ).toEqual({
      role: StoreSubAccountRole.manager,
      status: StoreSubAccountStatus.active,
      canAccessHome: true,
      canUseHandover: false,
    });
    expect(
      isMissingSubAccountQuotaSchemaError(
        new Error('column "sub_account_quota" does not exist'),
      ),
    ).toBe(true);
    expect(
      isMissingSubAccountQuotaSchemaError(new Error('connection timeout')),
    ).toBe(false);
  });
});
