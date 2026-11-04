// 微信侧主动核对：节流、交易状态、金额与流水号一致性是资金落账的最后一道闸门
import { RedisService } from '../../redis/redis.service';
import { AlertService } from '../../shared/alert/alert.service';
import { ClubWechatTransactionService } from './club-wechat-transaction.service';
import {
  ClubWechatVerifyService,
  type ClubWechatVerifyParams,
} from './club-wechat-verify.service';

describe('ClubWechatVerifyService', () => {
  const redisService = { setIfAbsent: jest.fn() };
  const alertService = { send: jest.fn().mockResolvedValue(undefined) };
  const transactionService = { queryByOutTradeNo: jest.fn() };

  let service: ClubWechatVerifyService;

  const params: ClubWechatVerifyParams = {
    scope: 'recharge',
    storeId: 11,
    outTradeNo: 'RC202606101231000001A2B',
    expectedAmountFen: 50000,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    redisService.setIfAbsent.mockResolvedValue(true);
    alertService.send.mockResolvedValue(undefined);

    service = new ClubWechatVerifyService(
      redisService as unknown as RedisService,
      alertService as unknown as AlertService,
      transactionService as unknown as ClubWechatTransactionService,
    );
  });

  // 节流：前端 500ms 级轮询不能把微信查单接口打爆
  it('节流命中时不回微信查单', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);

    await expect(service.confirmPaidOnWechat(params)).resolves.toBeNull();
    expect(transactionService.queryByOutTradeNo).not.toHaveBeenCalled();
  });

  it('force=true 时跳过节流（管理端人工补单）', async () => {
    redisService.setIfAbsent.mockResolvedValue(false);
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 50000,
        transactionId: 'wxTx123',
        paidAtMs: 1773558663000,
      },
    });

    await service.confirmPaidOnWechat({ ...params, force: true });

    expect(redisService.setIfAbsent).not.toHaveBeenCalled();
    expect(transactionService.queryByOutTradeNo).toHaveBeenCalled();
  });

  it('微信侧查不到交易时返回 null', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: false,
      code: 'ORDER_NOT_EXIST',
    });

    await expect(service.confirmPaidOnWechat(params)).resolves.toBeNull();
  });

  it('交易状态非 SUCCESS 时返回 null', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'NOTPAY',
        amountFen: 50000,
        transactionId: null,
      },
    });

    await expect(service.confirmPaidOnWechat(params)).resolves.toBeNull();
    expect(alertService.send).not.toHaveBeenCalled();
  });

  // 金额不一致宁可留待人工，也绝不按错误金额加余额 / 出券 / 出餐
  it('金额与本地不一致时告警且返回 null', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 1,
        transactionId: 'wxTx123',
        paidAtMs: 1773558663000,
      },
    });

    await expect(service.confirmPaidOnWechat(params)).resolves.toBeNull();
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        suppressKey: `recharge-amount-mismatch:${params.outTradeNo}`,
      }),
    );
  });

  it('已支付但缺少流水号时告警且返回 null', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 50000,
        transactionId: null,
        paidAtMs: 1773558663000,
      },
    });

    await expect(service.confirmPaidOnWechat(params)).resolves.toBeNull();
    expect(alertService.send).toHaveBeenCalledWith(
      expect.objectContaining({
        level: 'error',
        suppressKey: `recharge-missing-transaction:${params.outTradeNo}`,
      }),
    );
  });

  it('金额一致且流水号齐全时返回落账快照', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: 50000,
        transactionId: 'wxTx123',
        paidAtMs: 1773558663000,
      },
    });

    await expect(service.confirmPaidOnWechat(params)).resolves.toEqual({
      amountFen: 50000,
      transactionId: 'wxTx123',
      paidAtMs: 1773558663000,
    });
    expect(alertService.send).not.toHaveBeenCalled();
  });

  // 微信侧偶发不回金额：以本地应付金额为准，避免落账入参缺失
  it('微信侧未返回金额时用本地应付金额兜底', async () => {
    transactionService.queryByOutTradeNo.mockResolvedValue({
      found: true,
      snapshot: {
        tradeState: 'SUCCESS',
        amountFen: null,
        transactionId: 'wxTx123',
        paidAtMs: null,
      },
    });

    const verified = await service.confirmPaidOnWechat(params);

    expect(verified).toEqual(
      expect.objectContaining({ amountFen: 50000, transactionId: 'wxTx123' }),
    );
    expect(verified?.paidAtMs).toEqual(expect.any(Number));
  });
});
