import {
  BadRequestException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';

/** 飞鹅云打印接口地址（Configuration 注入，可被环境变量覆盖）。 */
interface FeiePrintConfig {
  user: string;
  ukey: string;
  apiUrl: string;
}

/** 飞鹅开放接口统一响应结构。 */
interface FeiePrintResponse {
  /** 返回码，0 表示成功。 */
  ret: number;
  /** 返回信息，成功为 "ok"。 */
  msg: string;
  /** 业务数据，接口不同结构不同；失败为 null。 */
  data: unknown;
}

/** 打印机在线状态（飞鹅返回文案归一化）。 */
export type FeiePrinterStatus = 'online' | 'offline' | 'abnormal' | 'unknown';

/** 飞鹅接口路径映射（2026-01 起官方按接口路径分流，不再使用统一入口）。 */
const API_PATHS: Record<string, string> = {
  Open_printMsg: 'printMsg',
  Open_queryPrinterStatus: 'queryPrinterStatus',
  Open_queryOrderState: 'queryOrderState',
  Open_printerAddlist: 'printerAddlist',
  Open_delPrinterSqs: 'delPrinterSqs',
};

/**
 * 飞鹅云打印 HTTP 客户端。
 * - 表单 POST 提交（Content-Type: application/x-www-form-urlencoded）
 * - 签名 sig = SHA1(user + ukey + stime)，40 位小写
 * - 请求地址按官方 2026-01-15「业务接口请求URL分流改造」使用路径化接口（base + 接口路径）
 * - 未配置账号时抛 503，不阻塞浏览器打印通道
 */
@Injectable()
export class FeiePrintService {
  private readonly config: FeiePrintConfig;

  constructor(private readonly configService: ConfigService) {
    this.config = {
      user: this.configService.get<string>('feiePrint.user') ?? '',
      ukey: this.configService.get<string>('feiePrint.ukey') ?? '',
      apiUrl: this.normalizeBaseUrl(
        this.configService.get<string>('feiePrint.apiUrl') ??
          'https://api.feieyun.cn/Api/Open/',
      ),
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
    this.assertReady(sn);
    const result = await this.request('Open_printMsg', {
      sn,
      content,
      times: String(times),
    });
    return typeof result.data === 'string' ? result.data : '';
  }

  /**
   * 查询云打印机在线状态（诊断用，下发前可预检）。
   * @param sn 打印机编号
   * @returns 归一化状态：online / offline / abnormal / unknown
   */
  async queryPrinterStatus(sn: string): Promise<FeiePrinterStatus> {
    this.assertReady(sn);
    const result = await this.request('Open_queryPrinterStatus', { sn });
    const raw = typeof result.data === 'string' ? result.data : '';
    if (raw.includes('正常')) {
      return 'online';
    }
    if (raw.includes('不正常')) {
      return 'abnormal';
    }
    if (raw.includes('离线')) {
      return 'offline';
    }
    return 'unknown';
  }

  /**
   * 查询订单是否已打印成功。
   * @param orderId 由 printMessage 返回的飞鹅订单 ID
   */
  async queryOrderState(orderId: string): Promise<boolean> {
    if (!orderId) {
      throw new BadRequestException('缺少飞鹅订单 ID');
    }
    const result = await this.request('Open_queryOrderState', {
      orderid: orderId,
    });
    return result.data === true;
  }

  /** 统一请求入口：签名、路径化 URL、表单提交、错误归一化。 */
  private async request(
    apiName: string,
    params: Record<string, string>,
  ): Promise<{ ret: number; msg: string; data: unknown }> {
    const stime = String(Math.floor(Date.now() / 1000));
    const sig = createHash('sha1')
      .update(`${this.config.user}${this.config.ukey}${stime}`)
      .digest('hex');

    const body = new URLSearchParams();
    body.set('user', this.config.user);
    body.set('stime', stime);
    body.set('sig', sig);
    body.set('apiname', apiName);
    for (const [key, value] of Object.entries(params)) {
      body.set(key, value);
    }

    const path = API_PATHS[apiName] ?? apiName;
    const url = `${this.config.apiUrl}${path}`;

    let response: Response;
    try {
      response = await fetch(url, {
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
      throw new ServiceUnavailableException(
        `飞鹅云打印失败（${apiName}）：${result.msg}`,
      );
    }
    return result;
  }

  /** 校验账号与 SN 是否就绪，未就绪抛对应异常。 */
  private assertReady(sn: string): void {
    if (!this.enabled) {
      throw new ServiceUnavailableException('飞鹅云打印未配置，请先配置账号');
    }
    if (!sn) {
      throw new BadRequestException('缺少飞鹅云打印机 SN');
    }
  }

  /** 规范化 base URL：确保以 / 结尾，避免路径拼接错位。 */
  private normalizeBaseUrl(apiUrl: string): string {
    return apiUrl.endsWith('/') ? apiUrl : `${apiUrl}/`;
  }
}
