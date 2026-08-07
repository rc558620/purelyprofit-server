import { BadRequestException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

/** 飞鹅云打印接口地址（Configuration 注入，可被环境变量覆盖）。 */
interface FeiePrintConfig {
  user: string;
  ukey: string;
  apiUrl: string;
}

/** 飞鹅 Open_printMsg 响应结构。 */
interface FeiePrintResponse {
  /** 返回码，0 表示成功。 */
  ret: number;
  /** 返回信息，成功为 "ok"。 */
  msg: string;
  /** 成功时返回订单 ID。 */
  data: string | null;
}

/**
 * 飞鹅云打印 HTTP 客户端：Open_printMsg 小票机打印。
 * - 表单 POST 提交（Content-Type: application/x-www-form-urlencoded）
 * - 签名 sig = SHA1(user + ukey + stime)，40 位小写
 * - 未配置账号时抛 503，不阻塞浏览器打印通道
 */
@Injectable()
export class FeiePrintService {
  private readonly config: FeiePrintConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      user: this.configService.get<string>('feiePrint.user') ?? '',
      ukey: this.configService.get<string>('feiePrint.ukey') ?? '',
      apiUrl:
        this.configService.get<string>('feiePrint.apiUrl') ??
        'https://api.de.feieyun.com/Api/Open/',
    };
  }

  /** 飞鹅云打印是否已配置可用。 */
  get enabled(): boolean {
    return Boolean(this.config.user && this.config.ukey);
  }

  /**
   * 下发小票打印任务到指定云打印机。
   * @param sn 打印机编号（云后台已绑定到开发者账号）
   * @param content 打印内容（支持 <BR>、<B></B>、<C></C> 等飞鹅标签，≤5000 字节）
   * @param times 打印份数，默认 1
   * @returns 飞鹅订单 ID（可用于查询打印状态）
   */
  async printMessage(sn: string, content: string, times = 1): Promise<string> {
    if (!this.enabled) {
      throw new ServiceUnavailableException('飞鹅云打印未配置，请先配置账号');
    }
    if (!sn) {
      throw new BadRequestException('缺少飞鹅云打印机 SN');
    }

    const stime = String(Math.floor(Date.now() / 1000));
    const sig = createHash('sha1')
      .update(`${this.config.user}${this.config.ukey}${stime}`)
      .digest('hex');

    const body = new URLSearchParams();
    body.set('user', this.config.user);
    body.set('stime', stime);
    body.set('sig', sig);
    body.set('apiname', 'Open_printMsg');
    body.set('sn', sn);
    body.set('content', content);
    body.set('times', String(times));

    let response: Response;
    try {
      response = await fetch(this.config.apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      });
    } catch (error) {
      throw new ServiceUnavailableException(
        `飞鹅云打印请求失败：${error instanceof Error ? error.message : '网络异常'}`,
      );
    }

    const result = (await response.json()) as FeiePrintResponse;
    if (result.ret !== 0) {
      throw new ServiceUnavailableException(`飞鹅云打印失败：${result.msg}`);
    }
    return result.data ?? '';
  }
}
