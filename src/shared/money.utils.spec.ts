import { Money, calcPercentPointDiff, calcMoneyRatio } from './money.utils';

describe('Money', () => {
  describe('static max', () => {
    it('returns the larger of two Money values', () => {
      const a = Money.fromInputYuan(100);
      const b = Money.fromInputYuan(200);
      expect(Money.max(a, b)).toBe(b);
      expect(Money.max(b, a)).toBe(b);
    });

    it('returns the first when equal', () => {
      const a = Money.fromInputYuan(100);
      const b = Money.fromInputYuan(100);
      expect(Money.max(a, b)).toBe(a);
    });
  });

  describe('static min', () => {
    it('returns the smaller of two Money values', () => {
      const a = Money.fromInputYuan(100);
      const b = Money.fromInputYuan(200);
      expect(Money.min(a, b)).toBe(a);
      expect(Money.min(b, a)).toBe(a);
    });

    it('returns the first when equal', () => {
      const a = Money.fromInputYuan(100);
      const b = Money.fromInputYuan(100);
      expect(Money.min(a, b)).toBe(a);
    });
  });

  describe('subtractClampedToZero', () => {
    it('returns positive difference when minuend > subtrahend', () => {
      const a = Money.fromInputYuan(300);
      const b = Money.fromInputYuan(100);
      const result = a.subtractClampedToZero(b);
      expect(result.toOutputYuan()).toBe(200);
    });

    it('returns zero when minuend === subtrahend', () => {
      const a = Money.fromInputYuan(100);
      const b = Money.fromInputYuan(100);
      const result = a.subtractClampedToZero(b);
      expect(result.isZero()).toBe(true);
    });

    it('returns zero when minuend < subtrahend (clamped)', () => {
      const a = Money.fromInputYuan(50);
      const b = Money.fromInputYuan(200);
      const result = a.subtractClampedToZero(b);
      expect(result.isZero()).toBe(true);
    });
  });

  describe('existing methods still work', () => {
    it('add', () => {
      const a = Money.fromInputYuan(10.5);
      const b = Money.fromInputYuan(20.3);
      expect(a.add(b).toOutputYuan()).toBe(30.8);
    });

    it('subtract', () => {
      const a = Money.fromInputYuan(20);
      const b = Money.fromInputYuan(10);
      expect(a.subtract(b).toOutputYuan()).toBe(10);
    });

    it('multiply', () => {
      const a = Money.fromInputYuan(100);
      expect(a.multiply(0.9).toOutputYuan()).toBe(90);
    });

    it('toOutputYuan', () => {
      expect(Money.fromInputYuan(1.23).toOutputYuan()).toBe(1.23);
      expect(Money.fromInputYuan(0.01).toOutputYuan()).toBe(0.01);
    });
  });
});

describe('calcPercentPointDiff', () => {
  it('returns positive difference when current > previous', () => {
    expect(calcPercentPointDiff(40, 30)).toBe(10);
  });

  it('returns negative difference when current < previous', () => {
    expect(calcPercentPointDiff(30, 40)).toBe(-10);
  });

  it('returns 0 when current equals previous', () => {
    expect(calcPercentPointDiff(50, 50)).toBe(0);
  });

  it('handles decimal differences with 2-digit precision', () => {
    expect(calcPercentPointDiff(38.46, 33.33)).toBe(5.13);
  });
});

describe('calcMoneyRatio', () => {
  it('returns correct ratio for income/expense', () => {
    const income = Money.fromInputYuan(1300);
    const expense = Money.fromInputYuan(400);
    // 1300 / 400 = 3.25
    expect(calcMoneyRatio(income, expense)).toBe(3.25);
  });

  it('returns null when denominator is zero', () => {
    const income = Money.fromInputYuan(500);
    const expense = Money.zero();
    expect(calcMoneyRatio(income, expense)).toBeNull();
  });

  it('returns 1 when numerator equals denominator', () => {
    const a = Money.fromInputYuan(100);
    const b = Money.fromInputYuan(100);
    expect(calcMoneyRatio(a, b)).toBe(1);
  });

  it('handles fractional results with 2-digit rounding', () => {
    const income = Money.fromInputYuan(100);
    const expense = Money.fromInputYuan(30);
    // 100 / 30 = 3.333... → rounded to 3.33
    expect(calcMoneyRatio(income, expense)).toBe(3.33);
  });

  it('returns less than 1 when numerator < denominator', () => {
    const income = Money.fromInputYuan(30);
    const expense = Money.fromInputYuan(100);
    expect(calcMoneyRatio(income, expense)).toBe(0.3);
  });
});
