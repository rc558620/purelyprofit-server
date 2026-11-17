import {
  MAX_PREPAY_ATTEMPT_SEQ,
  buildPrepayOutTradeNo,
  splitPrepayOutTradeNo,
} from './club-prepay-out-trade-no.util';

/** 服务购买单基准单号：SV + 时间戳 + 随机 HEX（23 字符） */
const SERVICE_ORDER_NO = 'SV20261116123000123ABCD';
/** 购卡单基准单号（22 字符） */
const CARD_ORDER_NO = 'MC1760000000000ABCD1234';

describe('club-prepay-out-trade-no', () => {
  describe('buildPrepayOutTradeNo', () => {
    it('追加两位序号后缀，且总长度不超微信 32 字符上限', () => {
      const serviceOutTradeNo = buildPrepayOutTradeNo(SERVICE_ORDER_NO, 1);
      const cardOutTradeNo = buildPrepayOutTradeNo(CARD_ORDER_NO, 12);

      expect(serviceOutTradeNo).toBe(`${SERVICE_ORDER_NO}-P01`);
      expect(cardOutTradeNo).toBe(`${CARD_ORDER_NO}-P12`);
      expect(serviceOutTradeNo.length).toBeLessThanOrEqual(32);
      expect(cardOutTradeNo.length).toBeLessThanOrEqual(32);
    });

    it('序号越界时钳到上限，非法值下限钳到 1', () => {
      expect(buildPrepayOutTradeNo(SERVICE_ORDER_NO, 0)).toBe(
        `${SERVICE_ORDER_NO}-P01`,
      );
      expect(buildPrepayOutTradeNo(SERVICE_ORDER_NO, 1234)).toBe(
        `${SERVICE_ORDER_NO}-P${MAX_PREPAY_ATTEMPT_SEQ}`,
      );
    });
  });

  describe('splitPrepayOutTradeNo', () => {
    it('SV / MC 的尝试单号可反解出基准单号与序号', () => {
      expect(splitPrepayOutTradeNo(`${SERVICE_ORDER_NO}-P03`)).toEqual({
        baseOrderNo: SERVICE_ORDER_NO,
        attemptSeq: 3,
      });
      expect(splitPrepayOutTradeNo(`${CARD_ORDER_NO}-P99`)).toEqual({
        baseOrderNo: CARD_ORDER_NO,
        attemptSeq: 99,
      });
    });

    it('未带后缀的单号原样返回（历史订单与已上线链路）', () => {
      expect(splitPrepayOutTradeNo(SERVICE_ORDER_NO)).toEqual({
        baseOrderNo: SERVICE_ORDER_NO,
        attemptSeq: null,
      });
      expect(splitPrepayOutTradeNo('RC20261116123000123ABCD')).toEqual({
        baseOrderNo: 'RC20261116123000123ABCD',
        attemptSeq: null,
      });
    });

    it('不误伤含连字符的自助下单商户单号（SF 前缀不在后缀白名单内）', () => {
      const selfOrderingNo = 'SF-123-1760000000000-abcdef';
      expect(splitPrepayOutTradeNo(selfOrderingNo)).toEqual({
        baseOrderNo: selfOrderingNo,
        attemptSeq: null,
      });
    });

    it('构造与反解严格互逆', () => {
      const outTradeNo = buildPrepayOutTradeNo(SERVICE_ORDER_NO, 7);
      expect(splitPrepayOutTradeNo(outTradeNo)).toEqual({
        baseOrderNo: SERVICE_ORDER_NO,
        attemptSeq: 7,
      });
    });
  });
});
