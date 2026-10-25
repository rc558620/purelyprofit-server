/**
 * 短信充值回调解密入口。
 *
 * 解密实现已上浮为 `PlatformWechatCallbackDecryptorService`
 * （平台收款链路通用：单一平台 APIv3Key，不遍历门店密钥），本类只做委托。
 *
 * 刻意**不改写**平台层抛出的异常文案：那会抹掉「密钥未配置」与
 * 「报文被篡改」这类关键区别，让线上排障只能看到一句笼统的失败。
 * 保留这一层入口是为了给短信链路将来可能的专属差异（如多密钥）留位置。
 */
import { Injectable } from '@nestjs/common';
import { PlatformWechatCallbackDecryptorService } from '../../payments/platform-wechat-callback-decryptor.service';
import type { WechatDecryptedTransaction } from '../../../purely-club/payments/dto/club-wechat-callback.dto';
import type { SmsWechatCallbackDto } from './dto/sms.dto';

@Injectable()
export class SmsWechatCallbackDecryptorService {
  constructor(
    private readonly platformDecryptorService: PlatformWechatCallbackDecryptorService,
  ) {}

  decryptCallback(
    payload: Pick<SmsWechatCallbackDto, 'resource'>,
  ): WechatDecryptedTransaction {
    return this.platformDecryptorService.decryptCallback(payload);
  }
}
