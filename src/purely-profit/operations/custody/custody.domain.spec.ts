// 客存领域纯函数单测：入参时间的时区闸门与临期判定口径（后端统一时效口径的唯一来源）
import { BadRequestException } from '@nestjs/common';
import { CUSTODY_EXPIRING_SOON_DAYS } from './custody.constants';
import {
  isExpiringSoon,
  parseIsoDate,
  resolveCustodyOperatorRole,
  resolveCustodyOperatorRoleFromStaff,
} from './custody.domain';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('parseIsoDate', () => {
  it('接受带 Z / ±HH:mm 时区后缀的 ISO 瞬时', () => {
    expect(
      parseIsoDate('2026-10-31T15:59:00.000Z', 'expireAt').toISOString(),
    ).toBe('2026-10-31T15:59:00.000Z');
    // +08:00 与 Z 指向同一瞬时：门店墙上时间换算后不该再被二次偏移
    expect(
      parseIsoDate('2026-10-31T23:59:00+08:00', 'expireAt').toISOString(),
    ).toBe('2026-10-31T15:59:00.000Z');
  });

  it('拒绝不带时区的裸串（JS 会按 UTC / 进程本地时区歧义解释，偏移 8 小时）', () => {
    expect(() => parseIsoDate('2026-10-31', 'expireAt')).toThrow(
      BadRequestException,
    );
    expect(() => parseIsoDate('2026-10-31 23:59', 'expireAt')).toThrow(
      BadRequestException,
    );
    expect(() => parseIsoDate('不是日期', 'expireAt')).toThrow(
      BadRequestException,
    );
  });
});

describe('isExpiringSoon', () => {
  const now = new Date('2026-10-01T08:00:00.000Z');
  const expireEdge = new Date(
    now.getTime() + CUSTODY_EXPIRING_SOON_DAYS * DAY_MS,
  );

  it('在存且剩余有效期落在阈值内才算临期（含边界）', () => {
    expect(isExpiringSoon('stored', expireEdge, now)).toBe(true);
    expect(
      isExpiringSoon('stored', new Date(expireEdge.getTime() + 1), now),
    ).toBe(false);
    expect(isExpiringSoon('stored', new Date(now.getTime() + 1), now)).toBe(
      true,
    );
  });

  it('已到期 / 长期有效 / 非在存状态均不算临期', () => {
    expect(isExpiringSoon('stored', now, now)).toBe(false);
    expect(
      isExpiringSoon('stored', new Date(now.getTime() - DAY_MS), now),
    ).toBe(false);
    expect(isExpiringSoon('stored', null, now)).toBe(false);
    // 已流逝为 expired 交给「已到期」表达，不再同时算作临期
    expect(isExpiringSoon('expired', expireEdge, now)).toBe(false);
    expect(isExpiringSoon('finished', expireEdge, now)).toBe(false);
  });
});

describe('resolveCustodyOperatorRole', () => {
  it('店员角色平移为可下发的操作员角色', () => {
    expect(resolveCustodyOperatorRole('owner')).toBe('owner');
    expect(resolveCustodyOperatorRole('manager')).toBe('manager');
    expect(resolveCustodyOperatorRole('staff')).toBe('staff');
  });

  it('店员档案缺失或角色不可识别时兜底为操作员（历史单据仍可渲染）', () => {
    expect(resolveCustodyOperatorRole(null)).toBe('staff');
    expect(resolveCustodyOperatorRole(undefined)).toBe('staff');
    expect(resolveCustodyOperatorRole('finance')).toBe('staff');
  });
});

describe('resolveCustodyOperatorRoleFromStaff', () => {
  it('userId 命中门店 ownerId 时判为主账号（历史 staff.role 可能仍是 manager）', () => {
    expect(
      resolveCustodyOperatorRoleFromStaff(
        { role: 'manager', userId: 7, subAccountRole: null },
        7,
      ),
    ).toBe('owner');
  });

  it('staff.role 为 owner 时兜底判为主账号', () => {
    expect(
      resolveCustodyOperatorRoleFromStaff(
        { role: 'owner', userId: null, subAccountRole: null },
        99,
      ),
    ).toBe('owner');
  });

  it('店长子账号按关联子账号角色判为店长', () => {
    expect(
      resolveCustodyOperatorRoleFromStaff(
        { role: 'staff', userId: 12, subAccountRole: 'manager' },
        7,
      ),
    ).toBe('manager');
  });

  it('普通店员 / 档案缺失一律兜底为操作员', () => {
    expect(
      resolveCustodyOperatorRoleFromStaff(
        { role: 'staff', userId: 12, subAccountRole: 'cashier' },
        7,
      ),
    ).toBe('staff');
    expect(resolveCustodyOperatorRoleFromStaff(null, 7)).toBe('staff');
  });
});
