import {
  buildSmsOrderNo,
  calcSegmentsPerRecipient,
  calcSmsSegments,
  countSmsSegmentDiff,
  formatFenAmountDisplay,
  normalizeSmsMobile,
  resolveSmsRechargeTiersFen,
  resolveSmsUnitPriceFen,
  toE164MainlandMobile,
  type SmsSegmentLimits,
} from './sms.utils';
import { SMS_SEGMENT_COUNT_MODE_DEFAULT } from './sms.constants';
import { SMS_ORDER_NO_PATTERN, isSmsOrderNo } from './dto/sms.dto';

const LIMITS: SmsSegmentLimits = { singleLimit: 70, longLimit: 67 };

function makeConfig(map: Record<string, unknown>) {
  return { get: jest.fn((key: string) => map[key]) };
}

describe('sms.utils', () => {
  describe('分段与计费条数', () => {
    it('70 字以内算 1 条', () => {
      expect(calcSegmentsPerRecipient('a'.repeat(70), LIMITS)).toBe(1);
    });

    it('71 字按长短信拆成 2 段', () => {
      expect(calcSegmentsPerRecipient('a'.repeat(71), LIMITS)).toBe(2);
    });

    it('134 字按 ceil(len/67) 拆成 2 段，135 字拆成 3 段', () => {
      expect(calcSegmentsPerRecipient('a'.repeat(134), LIMITS)).toBe(2);
      expect(calcSegmentsPerRecipient('a'.repeat(135), LIMITS)).toBe(3);
    });

    it('smsSegments 是「每人分段数 × 有效收件人数」的总条数，不是每人分段数', () => {
      // 这是前后端最容易搞错的点：写成每人分段数会让金额差 N 倍
      expect(calcSmsSegments('a'.repeat(10), 20, LIMITS)).toBe(20);
      expect(calcSmsSegments('a'.repeat(71), 20, LIMITS)).toBe(40);
    });

    it('无有效收件人时计费条数为 0', () => {
      expect(calcSmsSegments('hello', 0, LIMITS)).toBe(0);
    });

    it('emoji 的计数随口径不同：utf16 记 2 字，codepoint 记 1 字', () => {
      const content = '好'.repeat(69) + '😀';
      // 码点口径：69 + 1 = 70 字，未超单条上限
      expect(Array.from(content).length).toBe(70);
      expect(calcSegmentsPerRecipient(content, LIMITS, 'codepoint')).toBe(1);
      // UTF-16 口径：emoji 占 2 个码元 → 71 字，超 70 触发长短信拆分
      expect(content.length).toBe(71);
      expect(calcSegmentsPerRecipient(content, LIMITS, 'utf16')).toBe(2);
    });

    it('默认口径是 utf16（与腾讯云 UCS-2 计费一致）', () => {
      const content = '好'.repeat(69) + '😀';
      // 不传口径时按 utf16 算，避免含 emoji 的正文少收钱（差额曾由平台承担）
      expect(calcSegmentsPerRecipient(content, LIMITS)).toBe(2);
      expect(SMS_SEGMENT_COUNT_MODE_DEFAULT).toBe('utf16');
    });

    it('两种口径的差额可被观测（用于验证切换影响）', () => {
      const content = '好'.repeat(69) + '😀';
      expect(countSmsSegmentDiff(content, LIMITS)).toBe(1);
      // 不含 emoji 时两种口径一致，无差额
      expect(countSmsSegmentDiff('好'.repeat(71), LIMITS)).toBe(0);
    });
  });

  describe('手机号归一化', () => {
    it('去掉 +86 / 空格 / 连字符后返回 11 位号码', () => {
      expect(normalizeSmsMobile('+86 138 0013 8000')).toBe('13800138000');
      expect(normalizeSmsMobile('138-0013-8000')).toBe('13800138000');
    });

    it('非手机号段（12 开头 / 位数不足）返回 null，由调用方剔除', () => {
      expect(normalizeSmsMobile('12800138000')).toBeNull();
      expect(normalizeSmsMobile('1380013800')).toBeNull();
      expect(normalizeSmsMobile(null)).toBeNull();
      expect(normalizeSmsMobile('')).toBeNull();
    });

    it('转 E.164 供腾讯云 SendSms 使用', () => {
      expect(toE164MainlandMobile('13800138000')).toBe('+8613800138000');
    });
  });

  describe('订单号', () => {
    it('生成 SM 前缀订单号，且与 club 的 RC/SV 前缀互斥', () => {
      const orderNo = buildSmsOrderNo(Date.now());
      expect(SMS_ORDER_NO_PATTERN.test(orderNo)).toBe(true);
      expect(isSmsOrderNo(orderNo)).toBe(true);
    });

    it('非 SM 前缀订单号被判定为不属于短信充值（防止回调串台）', () => {
      expect(isSmsOrderNo('RC202610152030001234AB')).toBe(false);
      expect(isSmsOrderNo('SV202610152030001234AB')).toBe(false);
    });

    it('订单号 = SM + 17 位上海时区时间戳 + 4 位随机 HEX 后缀', () => {
      const now = Date.now();
      const first = buildSmsOrderNo(now);
      const second = buildSmsOrderNo(now);

      expect(first).toHaveLength(2 + 17 + 4);
      // 同一毫秒内时间戳段相同，靠随机后缀区分（与 club 的 RC/SV 订单号同策略）
      expect(first.slice(0, 19)).toBe(second.slice(0, 19));
      expect(first.slice(19)).toMatch(/^[0-9A-F]{4}$/);
    });
  });

  describe('配置解析', () => {
    it('单价非法时回落兜底值 5 分', () => {
      expect(resolveSmsUnitPriceFen(makeConfig({}) as never)).toBe(5);
      expect(
        resolveSmsUnitPriceFen(makeConfig({ 'sms.unitPriceFen': 0 }) as never),
      ).toBe(5);
      expect(
        resolveSmsUnitPriceFen(makeConfig({ 'sms.unitPriceFen': 8 }) as never),
      ).toBe(8);
    });

    it('档位配置非法时回落兜底档位', () => {
      expect(resolveSmsRechargeTiersFen(makeConfig({}) as never)).toEqual([
        1000, 5000, 10000, 30000, 50000,
      ]);
      expect(
        resolveSmsRechargeTiersFen(
          makeConfig({ 'sms.rechargeTiersFen': [0, 2000] }) as never,
        ),
      ).toEqual([2000]);
    });

    it('金额展示文案由后端下发', () => {
      expect(formatFenAmountDisplay(1000)).toBe('¥10');
      expect(formatFenAmountDisplay(500)).toBe('¥5');
    });
  });
});
