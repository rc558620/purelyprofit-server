import { createCipheriv } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { StoresWechatPayService } from '../../purely-profit/stores/stores-wechat-pay.service';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';
import type {
  ClubWechatPaymentCallbackDto,
  WechatDecryptedTransaction,
} from './dto/club-wechat-callback.dto';

const STORE_API_V3_KEY = '0123456789abcdef0123456789abcdef'; // 32 字节
const PARTNER_API_V3_KEY = 'fedcba9876543210fedcba9876543210'; // 32 字节
const NONCE = 'abcdefghijkl'; // 12 字节
const ASSOCIATED_DATA = 'transaction';

/** 按微信 v3 规范构造 resource.ciphertext（密文 || 16 字节 GCM Tag 的 base64）。 */
const encryptResource = (payload: unknown, key: string): string => {
  const cipher = createCipheriv(
    'aes-256-gcm',
    Buffer.from(key, 'utf8'),
    Buffer.from(NONCE, 'utf8'),
  );
  cipher.setAAD(Buffer.from(ASSOCIATED_DATA, 'utf8'));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(payload), 'utf8'),
    cipher.final(),
  ]);
  return Buffer.concat([ciphertext, cipher.getAuthTag()]).toString('base64');
};

const buildPayload = (
  key: string,
  tx: Partial<WechatDecryptedTransaction> = {},
): ClubWechatPaymentCallbackDto => ({
  id: 'notify-1',
  create_time: '2026-06-13T12:00:00+08:00',
  event_type: 'TRANSACTION.SUCCESS',
  resource: {
    algorithm: 'AEAD_AES_256_GCM',
    ciphertext: encryptResource(
      {
        out_trade_no: 'RC202606131200001234',
        transaction_id: '4200001234567890',
        trade_state: 'SUCCESS',
        mchid: '1234567890',
        appid: 'wx1234567890',
        amount: { total: 9900, payer_total: 9900 },
        ...tx,
      },
      key,
    ),
    nonce: NONCE,
    associated_data: ASSOCIATED_DATA,
  },
});

describe('ClubWechatCallbackDecryptorService', () => {
  const configState: Record<string, string | boolean> = {
    'wechat.partner.enabled': false,
    'wechat.partner.apiV3Key': PARTNER_API_V3_KEY,
  };
  const configService = { get: jest.fn((key: string) => configState[key]) };
  const storesWechatPayService = { listAllApiV3Keys: jest.fn() };

  const createService = (): ClubWechatCallbackDecryptorService =>
    new ClubWechatCallbackDecryptorService(
      configService as unknown as ConfigService,
      storesWechatPayService as unknown as StoresWechatPayService,
    );

  beforeEach(() => {
    jest.clearAllMocks();
    configState['wechat.partner.enabled'] = false;
    storesWechatPayService.listAllApiV3Keys.mockResolvedValue([
      STORE_API_V3_KEY,
    ]);
  });

  // ─── 直连模式（旧链路，灰度回滚窗口内保留）─────────────────────────────

  it('直连模式用门店密钥解密', async () => {
    const tx = await createService().decryptCallback(
      buildPayload(STORE_API_V3_KEY),
    );

    expect(tx.out_trade_no).toBe('RC202606131200001234');
    expect(tx.mchid).toBe('1234567890');
  });

  it('直连模式缓存密钥失效时强制刷新后重试成功', async () => {
    const staleKey = 'ffffffffffffffffffffffffffffffff';
    storesWechatPayService.listAllApiV3Keys
      .mockResolvedValueOnce([staleKey])
      .mockResolvedValueOnce([STORE_API_V3_KEY]);

    const tx = await createService().decryptCallback(
      buildPayload(STORE_API_V3_KEY),
    );

    expect(tx.out_trade_no).toBe('RC202606131200001234');
    expect(storesWechatPayService.listAllApiV3Keys).toHaveBeenLastCalledWith(
      true,
    );
  });

  it('直连模式全部密钥失败时抛 Unauthorized', async () => {
    storesWechatPayService.listAllApiV3Keys.mockResolvedValue([
      'ffffffffffffffffffffffffffffffff',
    ]);

    await expect(
      createService().decryptCallback(buildPayload(STORE_API_V3_KEY)),
    ).rejects.toThrow(UnauthorizedException);
  });

  // ─── 服务商模式 ────────────────────────────────────────────────────────

  it('服务商模式只用服务商密钥解密，不遍历门店密钥', async () => {
    configState['wechat.partner.enabled'] = true;

    const tx = await createService().decryptCallback(
      buildPayload(PARTNER_API_V3_KEY, {
        sp_mchid: 'SP0001',
        sub_mchid: 'SUB0001',
      }),
    );

    expect(tx.sp_mchid).toBe('SP0001');
    expect(tx.sub_mchid).toBe('SUB0001');
    // 关键纠错：服务商模式下子商户没有自己的密钥，遍历门店密钥是无效路径
    expect(storesWechatPayService.listAllApiV3Keys).not.toHaveBeenCalled();
  });

  it('服务商模式下拿门店密钥去解会失败（子商户密钥在微信侧不存在）', async () => {
    configState['wechat.partner.enabled'] = true;

    await expect(
      createService().decryptCallback(buildPayload(STORE_API_V3_KEY)),
    ).rejects.toThrow(UnauthorizedException);
    expect(storesWechatPayService.listAllApiV3Keys).not.toHaveBeenCalled();
  });

  it('服务商密钥未配置时明确报错，不降级为遍历门店密钥', async () => {
    configState['wechat.partner.enabled'] = true;
    delete configState['wechat.partner.apiV3Key'];

    await expect(
      createService().decryptCallback(buildPayload(PARTNER_API_V3_KEY)),
    ).rejects.toThrow(UnauthorizedException);

    configState['wechat.partner.apiV3Key'] = PARTNER_API_V3_KEY;
  });

  it('extractMerchantIdentity 服务商模式取 sp_mchid/sub_mchid', () => {
    configState['wechat.partner.enabled'] = true;
    const service = createService();

    expect(
      service.extractMerchantIdentity({
        out_trade_no: 'RC1',
        transaction_id: '4200',
        trade_state: 'SUCCESS',
        mchid: 'SP0001',
        sp_mchid: 'SP0001',
        sub_mchid: 'SUB0001',
        appid: 'wx1',
      }),
    ).toEqual({ signMchId: 'SP0001', settleMchId: 'SUB0001' });
  });

  it('extractMerchantIdentity 直连模式 mchid 同时作为签名主体与资金去向', () => {
    const service = createService();

    expect(
      service.extractMerchantIdentity({
        out_trade_no: 'RC1',
        transaction_id: '4200',
        trade_state: 'SUCCESS',
        mchid: 'STORE_MCH',
        appid: 'wx1',
      }),
    ).toEqual({ signMchId: 'STORE_MCH', settleMchId: 'STORE_MCH' });
  });

  // ─── 通用 ──────────────────────────────────────────────────────────────

  it('不支持的加密算法直接拒绝', async () => {
    const payload = buildPayload(STORE_API_V3_KEY);
    payload.resource.algorithm = 'AES_128_CBC';

    await expect(createService().decryptCallback(payload)).rejects.toThrow(
      UnauthorizedException,
    );
    expect(storesWechatPayService.listAllApiV3Keys).not.toHaveBeenCalled();
  });

  it('validateAndExtract 校验交易状态并取订单总额', () => {
    const service = createService();
    const tx: WechatDecryptedTransaction = {
      out_trade_no: 'RC1',
      transaction_id: '4200',
      trade_state: 'SUCCESS',
      mchid: '1234567890',
      appid: 'wx1',
      amount: { total: 9900, payer_total: 8900 },
    };

    // 用 total 而非 payer_total，与 draft.amountFen 口径一致
    expect(service.validateAndExtract(tx).amountFen).toBe(9900);
    expect(() =>
      service.validateAndExtract({ ...tx, trade_state: 'NOTPAY' }),
    ).toThrow();
  });
});
