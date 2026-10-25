// 支付二维码出图：把微信 Native 的 code_url 渲染成前端可直接展示的 PNG
//
// 为什么必须由后端出图：
// 微信 Native 下单返回的是 `weixin://wxpay/bizpayurl/...` 这种**协议串**，
// 浏览器 / 小程序 <img src> 加载它只会得到一个坏图，商家看到的是「空白二维码」。
// 若改由前端拿这个串去请求第三方在线生成服务，等于把支付链接明文交给外部——
// 后端直接出图既不外泄，也让前端渲染逻辑保持在「只展示、不加工」。
import { Injectable } from '@nestjs/common';
import QRCode from 'qrcode';

/** 二维码边长（px）：与扫码点餐桌码同规格 */
const PAYMENT_QR_CODE_SIZE = 240;

@Injectable()
export class PlatformPaymentQrCodeService {
  /**
   * 渲染支付二维码。
   *
   * 内容为空时抛错而不是返回空图：空白二维码会让商家以为下单成功、
   * 等到顾客扫不出来才发现，排查成本远高于在下单时就失败。
   */
  async renderPaymentQrCode(codeUrl: string): Promise<string> {
    const content = codeUrl?.trim();
    if (!content) {
      throw new Error('支付二维码内容为空，无法出图');
    }

    return QRCode.toDataURL(content, {
      width: PAYMENT_QR_CODE_SIZE,
      margin: 0,
      type: 'image/png',
    });
  }
}
