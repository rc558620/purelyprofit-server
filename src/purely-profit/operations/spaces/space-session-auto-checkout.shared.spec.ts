import { ConflictException } from '@nestjs/common';

import {
  assertAutoCheckoutDue,
  resolveAutoCheckoutFailureReason,
} from './space-session-auto-checkout.shared';

const START_TIME = new Date('2026-11-18T04:00:00.000Z');
const START_MS = START_TIME.getTime();
const MINUTE_MS = 60 * 1000;

describe('assertAutoCheckoutDue', () => {
  it('倒计时已到期时通过', () => {
    expect(() =>
      assertAutoCheckoutDue({
        startTime: START_TIME,
        countdownMinutes: 30,
        now: START_MS + 30 * MINUTE_MS,
      }),
    ).not.toThrow();
  });

  it('倒计时未到期时拒绝（终端时钟偏快场景）', () => {
    expect(() =>
      assertAutoCheckoutDue({
        startTime: START_TIME,
        countdownMinutes: 30,
        now: START_MS + 29 * MINUTE_MS,
      }),
    ).toThrow(ConflictException);
  });

  it('失败原因取单行文案并截断，避免把多行堆栈推给收银端', () => {
    expect(
      resolveAutoCheckoutFailureReason(new Error('shift lookup timeout')),
    ).toBe('shift lookup timeout');
    expect(resolveAutoCheckoutFailureReason(new Error('line1\n  line2'))).toBe(
      'line1 line2',
    );
    expect(
      resolveAutoCheckoutFailureReason(new Error('x'.repeat(300))),
    ).toHaveLength(120);
    expect(resolveAutoCheckoutFailureReason(undefined)).toBe('未知错误');
  });

  it('缺少有效倒计时时拒绝（避免 0 元/异常会话被自动结账）', () => {
    expect(() =>
      assertAutoCheckoutDue({
        startTime: START_TIME,
        countdownMinutes: null,
        now: START_MS + 60 * MINUTE_MS,
      }),
    ).toThrow(ConflictException);
    expect(() =>
      assertAutoCheckoutDue({
        startTime: START_TIME,
        countdownMinutes: 0,
        now: START_MS + 60 * MINUTE_MS,
      }),
    ).toThrow(ConflictException);
  });
});
