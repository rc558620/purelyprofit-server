import {
  buildCurrentPartnerApplication,
  buildPartnerApplications,
  deduplicateApplications,
} from './platform-membership-partner.domain';
import type {
  StorePartnerApplicationRecord,
  StorePartnerRecord,
} from './platform-membership.types';

/** 构造合伙人申请记录，默认字段可被覆盖 */
function buildApplicationRecord(
  overrides: Partial<StorePartnerApplicationRecord> = {},
): StorePartnerApplicationRecord {
  return {
    id: 1,
    storeId: 1,
    status: 'pending',
    name: '申请人',
    phone: '13800000000',
    idCard: 'A111',
    region: [],
    intention: 'agent',
    applyReason: null,
    paymentAccountType: 'wechat',
    paymentAccountNo: 'acc-001',
    paymentAccountName: '申请人',
    reviewedAt: null,
    joinedAt: null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    followUpNotes: [],
    ...overrides,
  };
}

/** 构造正式合伙人记录，默认字段可被覆盖 */
function buildPartnerRecord(
  overrides: Partial<StorePartnerRecord> = {},
): StorePartnerRecord {
  return {
    id: 100,
    status: 'approved',
    name: '合伙人',
    phone: '13800000000',
    idCard: 'A111',
    region: [],
    intention: 'agent',
    applyReason: null,
    paymentAccountType: 'wechat',
    paymentAccountNo: 'acc-001',
    paymentAccountName: '合伙人',
    beanBalance: 50,
    totalEarnedBeans: 80,
    totalWithdrawnBeans: 20,
    joinedAt: new Date('2026-01-02T00:00:00.000Z'),
    reviewedAt: new Date('2026-01-02T00:00:00.000Z'),
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

describe('buildCurrentPartnerApplication', () => {
  it('#5 已通过合伙人存在更晚创建的被驳回申请时，应优先返回匹配的已通过申请', () => {
    // 已通过合伙人档案：idCard=A111 / phone=138
    const partner = buildPartnerRecord({
      idCard: 'A111',
      phone: '13800000000',
    });

    // 全新身份（idCard 与 phone 均不同）的更晚申请，且已被驳回
    const rejectedNewApplication = buildApplicationRecord({
      id: 2,
      status: 'rejected',
      idCard: 'B222',
      phone: '13900000000',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    // 与合伙人匹配的已通过申请（创建时间更早）
    const approvedApplication = buildApplicationRecord({
      id: 1,
      status: 'approved',
      idCard: 'A111',
      phone: '13800000000',
      reviewedAt: new Date('2026-01-02T00:00:00.000Z'),
      joinedAt: new Date('2026-01-02T00:00:00.000Z'),
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    // 输入按 createdAt desc 排序（最新在前）
    const result = buildCurrentPartnerApplication(
      [rejectedNewApplication, approvedApplication],
      partner,
    );

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(result?.id).toBe('1');
    // 匹配到合伙人，纯利豆摘要应来自合伙人档案
    expect(result?.beanBalance).toBe(50);
    expect(result?.totalEarnedBeans).toBe(80);
    expect(result?.totalWithdrawnBeans).toBe(20);
  });

  it('#5 存在多条已通过申请时，应返回最新一条匹配的已通过申请', () => {
    const partner = buildPartnerRecord({ idCard: 'A111' });

    const newerApproved = buildApplicationRecord({
      id: 3,
      status: 'approved',
      idCard: 'A111',
      createdAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    const olderApproved = buildApplicationRecord({
      id: 1,
      status: 'approved',
      idCard: 'A111',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = buildCurrentPartnerApplication(
      [newerApproved, olderApproved],
      partner,
    );

    expect(result?.id).toBe('3');
    expect(result?.status).toBe('approved');
  });

  it('回归：未成为合伙人时，仍返回最新一条申请（保持原逻辑）', () => {
    const latest = buildApplicationRecord({
      id: 2,
      status: 'pending',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });
    const older = buildApplicationRecord({
      id: 1,
      status: 'rejected',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const result = buildCurrentPartnerApplication([latest, older], null);

    expect(result?.id).toBe('2');
    expect(result?.status).toBe('pending');
  });

  it('B2 回归：已通过合伙人但无匹配的已通过申请时，返回 legacy 合伙人档案（避免余额错显 0）', () => {
    // 合伙人为历史快照身份（idCard=C333），与现有申请均不匹配
    const partner = buildPartnerRecord({
      idCard: 'C333',
      phone: '13700000000',
    });
    const latestPending = buildApplicationRecord({
      id: 2,
      status: 'pending',
      idCard: 'A111',
      phone: '13800000000',
      createdAt: new Date('2026-03-01T00:00:00.000Z'),
    });

    const result = buildCurrentPartnerApplication([latestPending], partner);

    // B2 修复后：不再拼接不匹配的申请，直接以真实合伙人档案返回
    expect(result?.id).toBe(String(partner.id));
    expect(result?.status).toBe('approved');
    expect(result?.beanBalance).toBe(partner.beanBalance);
  });

  it('回归：无任何申请但存在合伙人时，返回 legacy 合伙人摘要', () => {
    const partner = buildPartnerRecord({ idCard: 'A111' });

    const result = buildCurrentPartnerApplication([], partner);

    expect(result).not.toBeNull();
    expect(result?.status).toBe('approved');
    expect(result?.id).toBe(String(partner.id));
    expect(result?.beanBalance).toBe(50);
  });

  it('回归：无申请且无合伙人时，返回 null', () => {
    expect(buildCurrentPartnerApplication([], null)).toBeNull();
  });
});

describe('deduplicateApplications', () => {
  it('同身份证换号时按身份证去重为一条', () => {
    const apps = [
      buildApplicationRecord({ id: 1, idCard: 'A111', phone: '13800000000' }),
      buildApplicationRecord({ id: 2, idCard: 'A111', phone: '13900000000' }),
    ];
    const result = deduplicateApplications(apps);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(1);
  });

  it('不同身份证相同手机号不去重（视为不同人）', () => {
    const apps = [
      buildApplicationRecord({ id: 1, idCard: 'A111', phone: '13800000000' }),
      buildApplicationRecord({ id: 2, idCard: 'B222', phone: '13800000000' }),
    ];
    const result = deduplicateApplications(apps);
    expect(result).toHaveLength(2);
  });
});

describe('buildPartnerApplications 同人匹配', () => {
  it('同手机号不同身份证不视为同一合伙人（修正 OR 匹配误判）', () => {
    const partner = buildPartnerRecord({
      idCard: 'A111',
      phone: '13800000000',
      beanBalance: 50,
    });
    const app = buildApplicationRecord({
      id: 2,
      idCard: 'B222',
      phone: '13800000000',
      status: 'pending',
    });
    const result = buildPartnerApplications([app], partner);
    expect(result).toHaveLength(1);
    // 不应误用合伙人余额
    expect(result[0].beanBalance).toBe(0);
  });
});
