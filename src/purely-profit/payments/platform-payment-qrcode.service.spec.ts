import { InternalServerErrorException } from '@nestjs/common';
import { PlatformPaymentQrCodeService } from './platform-payment-qrcode.service';

/**
 * 二维码出图是「用户能不能扫出码」的唯一出口：
 * 出图失败又没有报错，商家会看到一张空白二维码，直到顾客扫不出来才发现。
 */
describe('PlatformPaymentQrCodeService', () => {
  let service: PlatformPaymentQrCodeService;

  beforeEach(() => {
    service = new PlatformPaymentQrCodeService();
  });

  it('把 weixin:// 协议串渲染成 PNG data URL', async () => {
    const image = await service.renderPaymentQrCode(
      'weixin://wxpay/bizpayurl?pr=abc123',
    );

    expect(image.startsWith('data:image/png;base64,')).toBe(true);
    // 空图会退化成极短字符串，这里兜一道：真实二维码 base64 至少上百字符
    expect(image.length).toBeGreaterThan(100);
  });

  it('内容为空串时抛错，而不是返回一张空图', async () => {
    await expect(service.renderPaymentQrCode('')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('内容只有空白字符时同样抛错', async () => {
    await expect(service.renderPaymentQrCode('   ')).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it('内容为 undefined 时抛错，不把空串交给编码器', async () => {
    await expect(
      service.renderPaymentQrCode(undefined as unknown as string),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it('不同支付单渲染出不同图片，不会复用同一张码', async () => {
    const first = await service.renderPaymentQrCode(
      'weixin://wxpay/bizpayurl?pr=aaa',
    );
    const second = await service.renderPaymentQrCode(
      'weixin://wxpay/bizpayurl?pr=bbb',
    );

    expect(first).not.toBe(second);
  });
});
