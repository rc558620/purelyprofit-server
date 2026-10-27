/**
 * 微信支付 API v3 请求客户端（purely-club · 门店收款商户号）。
 *
 * 下单（JSAPI）、查单、关单三条接口共用同一套基础设施：
 *   - 商户私钥加载与缓存（生产环境 fail-fast，见 A2）
 *   - WECHATPAY2-SHA256-RSA2048 鉴权头构造
 *   - 请求超时上限与错误响应解析
 *
 * 从 ClubWechatJsapiService 抽出的原因：查单与关单必须复用同一份签名与私钥逻辑。
 * 若各自复制一份，「私钥加载失败时是否降级为占位签名」这类资金安全口径会在
 * 不同接口之间漂移，最终出现「下单报错、查单却返回看起来正常的假结果」。
 */
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/** 微信支付 API v3 基址 */
const WECHAT_API_BASE = 'https://api.mch.weixin.qq.com';

/**
 * 微信 API 请求超时（毫秒）。
 *
 * 微信侧挂起时若不设上限，下单 / 关单会无限等待，把 Node 事件循环里的连接
 * 和上层请求一起拖住；框架层的 requestTimeout 只断客户端，不会中断 fetch。
 */
const WECHAT_REQUEST_TIMEOUT_MS = 8000;

/** 私钥缓存有效期：5 分钟，支持证书热更新而不必重启进程 */
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/** 未配置私钥时的占位签名：请求会被微信拒绝，但不会让本地链路崩溃 */
const DEV_PLACEHOLDER_SIGNATURE = 'DEV_MODE_NO_RSA_KEY';

export interface WechatPayRequestParams {
  method: 'GET' | 'POST';
  /**
   * 参与签名的 canonical url（不含域名），形如 `/v3/pay/transactions/jsapi`。
   *
   * ⚠️ 该值同时用于签名与实际请求，因此调用方若要把业务单号拼进路径，
   * 必须先 `encodeURIComponent`。项目订单号仅含字母数字与连字符（编码前后一致），
   * 不存在「URL 能通、签名对不上」的风险。
   */
  urlPath: string;
  /** 收款商户号（门店配置），参与鉴权头 */
  mchId: string;
  /** query 串，不含 `?`；同时参与签名 */
  query?: string;
  /** POST 请求体；GET 时为空串参与签名 */
  body?: string;
}

export type WechatPayResponse<T> =
  | { ok: true; status: number; data: T }
  | { ok: false; status: number; code: string | null; message: string };

interface WechatErrorResponse {
  code?: string;
  message?: string;
}

@Injectable()
export class ClubWechatPayHttpService {
  private readonly logger = new Logger(ClubWechatPayHttpService.name);
  private readonly nodeEnv: string;

  private cachedPrivateKeyPem: string | null | undefined = undefined;
  private cachedPrivateKeyPemLoadedAt = 0;
  /** 正在进行的私钥加载：并发请求共用同一次 IO，避免缓存失效瞬间重复 readFile */
  private privateKeyLoadInFlight: Promise<string | null> | null = null;

  constructor(private readonly configService: ConfigService) {
    this.nodeEnv = this.configService.get<string>('nodeEnv') ?? 'development';
  }

  /** 是否生产环境：生产禁用一切「签名降级」路径 */
  isProduction(): boolean {
    return this.nodeEnv === 'production';
  }

  /**
   * 发起一次微信支付 API v3 请求。
   *
   * 微信返回 4xx / 5xx 时不抛异常，而是返回 `ok: false` 并带回微信错误码，
   * 由调用方按错误码决定语义（例如关单遇到 `ORDERPAID` 意味着用户其实已付款）。
   * 只有网络层不可达才抛 `InternalServerErrorException`。
   */
  async request<T>(
    params: WechatPayRequestParams,
  ): Promise<WechatPayResponse<T>> {
    const serialNo = this.getRequiredConfig('wechat.mchSerialNo');
    const privateKeyPem = await this.loadPrivateKeyPem();
    const canonicalUrl = params.query
      ? `${params.urlPath}?${params.query}`
      : params.urlPath;

    const authorization = this.buildAuthorization({
      mchId: params.mchId,
      serialNo,
      privateKeyPem,
      method: params.method,
      canonicalUrl,
      body: params.body ?? '',
    });

    const response = await this.send({
      url: `${WECHAT_API_BASE}${canonicalUrl}`,
      method: params.method,
      authorization,
      body: params.body,
    });

    if (response.ok) {
      return {
        ok: true,
        status: response.status,
        data: await this.readJson<T>(response),
      };
    }

    const errorPayload = await this.readErrorPayload(response);
    return {
      ok: false,
      status: response.status,
      code: errorPayload?.code ?? null,
      message: errorPayload?.message ?? '',
    };
  }

  /**
   * RSA-SHA256 签名，返回 Base64。
   *
   * 供 JSAPI 组装前端 paySign 复用：paySign 与鉴权头必须用同一把私钥，
   * 否则前端拿到的是「能拉起但必被拒」的参数。
   */
  signWithRsa(message: string, privateKeyPem: string | null): string {
    if (!privateKeyPem) {
      this.logger.warn(
        '微信支付私钥未配置，使用开发态占位签名（微信将拒绝此请求）',
      );
      return DEV_PLACEHOLDER_SIGNATURE;
    }

    try {
      const privateKey = createPrivateKey(privateKeyPem);
      const sign = createSign('RSA-SHA256');
      sign.update(message, 'utf8');
      return sign.sign(privateKey, 'base64');
    } catch (error) {
      this.logger.error('RSA 签名失败，商户私钥格式可能有误', error);
      throw new InternalServerErrorException(
        '微信支付签名失败，请检查私钥配置是否正确',
      );
    }
  }

  /**
   * 加载商户 RSA 私钥 PEM（文件路径 > 内联内容 > 开发态 null）。
   *
   * 生产环境未配置时**直接失败**：降级成占位签名会让请求看起来正常发出，
   * 实际必被微信拒绝，前端只看到「支付失败」，排查成本极高。
   */
  async loadPrivateKeyPem(): Promise<string | null> {
    if (
      this.cachedPrivateKeyPem !== undefined &&
      Date.now() - this.cachedPrivateKeyPemLoadedAt < PRIVATE_KEY_CACHE_TTL_MS
    ) {
      return this.cachedPrivateKeyPem;
    }

    if (!this.privateKeyLoadInFlight) {
      this.privateKeyLoadInFlight = this.loadPrivateKeyPemFromSource().finally(
        () => {
          this.privateKeyLoadInFlight = null;
        },
      );
    }
    return this.privateKeyLoadInFlight;
  }

  // ─── 请求发送与响应解析 ───────────────────────────────────────────────────

  private async send(params: {
    url: string;
    method: 'GET' | 'POST';
    authorization: string;
    body?: string;
  }): Promise<Response> {
    try {
      return await fetch(params.url, {
        method: params.method,
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: params.authorization,
          'User-Agent': 'purelyprofit-server/1.0',
        },
        ...(params.body ? { body: params.body } : {}),
        signal: AbortSignal.timeout(WECHAT_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error(
        `微信支付接口请求异常 method=${params.method} path=${params.url.replace(WECHAT_API_BASE, '')}`,
        error,
      );
      throw new InternalServerErrorException(
        '微信支付服务暂时不可用，请稍后重试',
      );
    }
  }

  /** 成功响应体解析；关单返回 204 时无响应体，按 null 处理 */
  private async readJson<T>(response: Response): Promise<T> {
    if (response.status === 204) {
      return null as T;
    }
    return (await response.json()) as T;
  }

  private async readErrorPayload(
    response: Response,
  ): Promise<WechatErrorResponse | null> {
    try {
      return (await response.json()) as WechatErrorResponse;
    } catch {
      return null;
    }
  }

  // ─── 配置与签名 ───────────────────────────────────────────────────────────

  getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new InternalServerErrorException(
        `环境变量 ${key} 未配置，无法发起微信支付`,
      );
    }
    return value.trim();
  }

  /** 组装 WECHATPAY2-SHA256-RSA2048 鉴权头 */
  private buildAuthorization(params: {
    mchId: string;
    serialNo: string;
    privateKeyPem: string | null;
    method: string;
    canonicalUrl: string;
    body: string;
  }): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');

    const signMessage = [
      params.method,
      params.canonicalUrl,
      timestamp,
      nonce,
      params.body,
      '',
    ].join('\n');

    return [
      `WECHATPAY2-SHA256-RSA2048 mchid="${params.mchId}"`,
      `nonce_str="${nonce}"`,
      `signature="${this.signWithRsa(signMessage, params.privateKeyPem)}"`,
      `timestamp="${timestamp}"`,
      `serial_no="${params.serialNo}"`,
    ].join(',');
  }

  /** 真正读取私钥（文件优先，其次内联），结果写入缓存 */
  private async loadPrivateKeyPemFromSource(): Promise<string | null> {
    // 先清缓存再加载：读取失败时不会残留上一次的旧值
    this.cachedPrivateKeyPem = undefined;
    this.cachedPrivateKeyPemLoadedAt = Date.now();

    const keyPath = this.configService
      .get<string>('wechat.privateKeyPath')
      ?.trim();
    if (keyPath) {
      try {
        const pem = await readFile(keyPath, 'utf8');
        this.cachedPrivateKeyPem = pem;
        return pem;
      } catch (error) {
        this.logger.error(`读取微信支付私钥文件失败: ${keyPath}`, error);
        throw new InternalServerErrorException(
          '读取微信支付私钥文件失败，请检查 WECHAT_PRIVATE_KEY_PATH 配置',
        );
      }
    }

    const keyContent = this.configService
      .get<string>('wechat.privateKeyContent')
      ?.trim();
    if (keyContent) {
      // 支持环境变量中以字面 \n 代替换行的写法
      const pem = keyContent.replace(/\\n/g, '\n');
      this.cachedPrivateKeyPem = pem;
      return pem;
    }

    if (this.isProduction()) {
      this.logger.error(
        '生产环境未配置微信支付商户私钥（WECHAT_PRIVATE_KEY_PATH / WECHAT_PRIVATE_KEY_CONTENT），' +
          '拒绝生成支付参数，避免下发注定被微信拒绝的签名',
      );
      throw new InternalServerErrorException(
        '微信支付商户私钥未配置，支付暂不可用，请联系平台管理员',
      );
    }

    this.logger.warn('微信支付私钥未配置，将使用开发态占位签名');
    this.cachedPrivateKeyPem = null;
    return null;
  }
}
