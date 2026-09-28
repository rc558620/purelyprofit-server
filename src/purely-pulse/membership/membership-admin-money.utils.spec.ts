import {
  resolveAmountFen,
  resolvePriceFen,
} from './membership-admin-money.utils';

/**
 * 元字符串 → 分 是三个写入/计算入口共用的解析，
 * 两者的差别只有「是否允许 0」，必须各自锁死，否则改一处会悄悄影响另两处。
 */
describe('membership-admin-money.utils', () => {
  describe('resolvePriceFen（成交价，不允许 0）', () => {
    it('正常金额转分', () => {
      expect(resolvePriceFen('598')).toBe(59800);
      expect(resolvePriceFen('82.19')).toBe(8219);
      expect(resolvePriceFen(' 650 ')).toBe(65000);
    });

    it('缺失 / 空串 / 非数字返回 null', () => {
      expect(resolvePriceFen()).toBeNull();
      expect(resolvePriceFen(null)).toBeNull();
      expect(resolvePriceFen('')).toBeNull();
      expect(resolvePriceFen('abc')).toBeNull();
    });

    it('0 与负数不是有效成交价', () => {
      expect(resolvePriceFen('0')).toBeNull();
      expect(resolvePriceFen('0.00')).toBeNull();
      expect(resolvePriceFen('-1')).toBeNull();
    });
  });

  describe('resolveAmountFen（子账号加价，允许 0）', () => {
    it('正常金额转分', () => {
      expect(resolveAmountFen('150')).toBe(15000);
      expect(resolveAmountFen(' 12.5 ')).toBe(1250);
    });

    it('0 是有效取值（明确表示不收子账号的钱）', () => {
      expect(resolveAmountFen('0')).toBe(0);
      expect(resolveAmountFen('0.00')).toBe(0);
    });

    it('负数返回 null', () => {
      expect(resolveAmountFen('-1')).toBeNull();
    });

    it('空串与缺失视为「未录入」而非 0', () => {
      expect(resolveAmountFen('')).toBeNull();
      expect(resolveAmountFen()).toBeNull();
      expect(resolveAmountFen(null)).toBeNull();
    });
  });
});
