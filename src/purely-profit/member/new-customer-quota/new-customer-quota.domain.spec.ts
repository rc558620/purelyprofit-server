import {
  calcQuotaByAmountFen,
  formatAmountFenToYuanDisplay,
  resolvePlanGrant,
  resolvePlanGrantLabel,
} from './new-customer-quota.domain';

describe('新用户额度领域计算', () => {
  it('按 0.03 元/位新客换算，向下取整', () => {
    expect(calcQuotaByAmountFen(1000)).toBe(333);
    expect(calcQuotaByAmountFen(5000)).toBe(1666);
    expect(calcQuotaByAmountFen(10000)).toBe(3333);
    expect(calcQuotaByAmountFen(0)).toBe(0);
    // 不足一次的金额不折算：避免多送
    expect(calcQuotaByAmountFen(1)).toBe(0);
    expect(calcQuotaByAmountFen(100)).toBe(33);
  });

  it('会员档位赠送额度：月 50 / 季 100 / 年 300 / 永久 300 / 免费 0', () => {
    expect(resolvePlanGrant('monthly')).toBe(50);
    expect(resolvePlanGrant('quarterly')).toBe(100);
    expect(resolvePlanGrant('yearly')).toBe(300);
    expect(resolvePlanGrant('lifetime')).toBe(300);
    expect(resolvePlanGrant('free')).toBe(0);
  });

  it('未知或缺失档位不赠送', () => {
    expect(resolvePlanGrant('unknown')).toBe(0);
    expect(resolvePlanGrant(null)).toBe(0);
    expect(resolvePlanGrant(undefined)).toBe(0);
  });

  it('金额展示：分 → 元（仅格式化，不做业务计算）', () => {
    expect(formatAmountFenToYuanDisplay(1000)).toBe('¥10');
    expect(formatAmountFenToYuanDisplay(10000)).toBe('¥100');
  });

  it('档位展示名用于流水说明', () => {
    expect(resolvePlanGrantLabel('monthly')).toBe('月度会员');
    expect(resolvePlanGrantLabel('lifetime')).toBe('永久会员');
    expect(resolvePlanGrantLabel(undefined)).toBe('会员');
  });
});
