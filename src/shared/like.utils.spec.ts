// LIKE / ILIKE 通配符转义回归：普通关键词逐字节不变，含元字符的输入被还原成字面量
import { buildContainsPattern, escapeLikePattern } from './like.utils';

describe('like.utils', () => {
  describe('escapeLikePattern', () => {
    it('普通关键词原样返回：与改动前的内联拼接口径逐字节一致', () => {
      expect(escapeLikePattern('张伟')).toBe('张伟');
      expect(escapeLikePattern('13800138000')).toBe('13800138000');
      expect(escapeLikePattern('可乐 大杯')).toBe('可乐 大杯');
      expect(escapeLikePattern("O'Brien")).toBe("O'Brien");
    });

    it('百分号转义为字面量，不再退化成「匹配一切」', () => {
      expect(escapeLikePattern('%')).toBe('\\%');
      expect(escapeLikePattern('50%')).toBe('50\\%');
      expect(escapeLikePattern('%%')).toBe('\\%\\%');
    });

    it('下划线转义为字面量，不再退化成单字符通配', () => {
      expect(escapeLikePattern('_')).toBe('\\_');
      expect(escapeLikePattern('A_B')).toBe('A\\_B');
    });

    it('反斜杠自身先被转义，避免构成非法转义序列', () => {
      expect(escapeLikePattern('\\')).toBe('\\\\');
      expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
    });

    it('混合输入按字符逐个转义，顺序不影响结果', () => {
      expect(escapeLikePattern('50%_off\\')).toBe('50\\%\\_off\\\\');
    });

    it('中文与空串不受转义影响', () => {
      expect(escapeLikePattern('会员_积分')).toBe('会员\\_积分');
      expect(escapeLikePattern('')).toBe('');
    });
  });

  describe('buildContainsPattern', () => {
    it('空值一律返回 null，调用方据此跳过过滤条件', () => {
      expect(buildContainsPattern(undefined)).toBeNull();
      expect(buildContainsPattern(null)).toBeNull();
      expect(buildContainsPattern('')).toBeNull();
    });

    it('普通关键词产出与旧实现完全相同的 %kw% 模式串', () => {
      expect(buildContainsPattern('张伟')).toBe('%张伟%');
      expect(buildContainsPattern('138')).toBe('%138%');
    });

    it('含通配符的关键词被转义后仍包在 % 之间', () => {
      expect(buildContainsPattern('50%')).toBe('%50\\%%');
      expect(buildContainsPattern('A_B')).toBe('%A\\_B%');
      expect(buildContainsPattern('\\')).toBe('%\\\\%');
    });

    it('不做 trim：空白保持原样，避免同一输入在两条路径上口径分裂', () => {
      expect(buildContainsPattern('  张伟  ')).toBe('%  张伟  %');
      expect(buildContainsPattern('   ')).toBe('%   %');
    });
  });
});
