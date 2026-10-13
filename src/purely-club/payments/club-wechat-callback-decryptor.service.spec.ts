import { createCipheriv } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';
import { ClubWechatCallbackDecryptorService } from './club-wechat-callback-decryptor.service';
import type {
  ClubWechatPaymentCallbackDto,
  WechatDecryptedTransaction,
} from './dto/club-wechat-callback.dto';

const API_V3_KEY = '0123456789abcdef0123456789abcdef'; // 32 字节
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

const buildPayload = (key: string): ClubWechatPaymentCallbackDto => ({
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
      },
      key,
    ),
    nonce: NONCE,
    associated_data: ASSOCIATED_DATA,
  },
});

describe('ClubWechatCallbackDecryptorService', () => {
  const storesWechatPayService = {
    listAllApiV3Keys: jest.fn(),
  };

  const createService = (): ClubWechatCallbackDecryptorService =>
    new ClubWechatCallbackDecryptorService(storesWechatPayService as never);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('用已配置密钥解密回调报文', async () => {
    storesWechatPayService.listAllApiV3Keys.mockResolvedValue([API_V3_KEY]);

    const tx = await createService().decryptCallback(buildPayload(API_V3_KEY));

    expect(tx.out_trade_no).toBe('RC202606131200001234');
    expect(tx.mchid).toBe('1234567890');
  });

  it('缓存密钥过期时强制刷新后重试成功', async () => {
    const staleKey = 'ffffffffffffffffffffffffffffffff';
    const payload = buildPayload(API_V3_KEY);

    // 首次拿到的是旧列表，刷新后才是真正可用的密钥
    storesWechatPayService.listAllApiV3Keys
      .mockResolvedValueOnce([staleKey])
      .mockResolvedValueOnce([API_V3_KEY]);

    const tx = await createService().decryptCallback(payload);

    expect(tx.out_trade_no).toBe('RC202606131200001234');
    expect(storesWechatPayService.listAllApiV3Keys).toHaveBeenCalledTimes(2);
    expect(storesWechatPayService.listAllApiV3Keys).toHaveBeenLastCalledWith(
      true,
    );
  });

  it('全部密钥都无法解密时抛 Unauthorized', async () => {
    storesWechatPayService.listAllApiV3Keys.mockResolvedValue([
      'ffffffffffffffffffffffffffffffff',
    ]);

    await expect(
      createService().decryptCallback(buildPayload(API_V3_KEY)),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('未配置任何商户时直接拒绝', async () => {
    storesWechatPayService.listAllApiV3Keys.mockResolvedValue([]);

    await expect(
      createService().decryptCallback(buildPayload(API_V3_KEY)),
    ).rejects.toThrow(UnauthorizedException);
    expect(storesWechatPayService.listAllApiV3Keys).toHaveBeenCalledTimes(1);
  });

  it('不支持的加密算法直接拒绝', async () => {
    const payload = buildPayload(API_V3_KEY);
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
