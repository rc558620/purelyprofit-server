/**
 * 微信支付 API v3 请求客户端（purely-profit · 平台收款商户号）。
 *
 * Native 下单、查单、关单三条接口共用同一套基础设施：
 *   - 商户私钥加载与缓存（文件优先 > 内联内容 > 开发态占位签名）
 *   - WECHATPAY2-SHA256-RSA2048 鉴权头构造（GET / POST 两种签名串）
 *   - 请求超时上限与错误响应解析
 *
 * 从 `PlatformWechatNativeService` 抽出的原因：加入「主动查单」后该文件超过
 * 规范上限（400 行）。但拆分的真正判据不是行数，而是职责 —— 签名与私钥加载
 * 属于**传输层**，与「下单 / 关单 / 查单」的业务语义无关。两者混在一起时，
 * 「私钥加载失败是否降级为占位签名」这类资金安全口径会随接口数量一起复制，
 * 最终出现「下单报错、查单却返回看似正常的假结果」。
 *
 * 与 club 侧 `ClubWechatPayHttpService` 同构，区别只在商户号来源：
 * club 取门店收款配置，平台侧一律取 `wechat.payMchId`。
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
 * 微信侧挂起时若不设上限，下单 / 关单会无限等待，把 Node 事件循环里的
 * 连接和上层请求一起拖住；框架层的 requestTimeout 只断客户端，不会中断 fetch。
 */
const WECHAT_REQUEST_TIMEOUT_MS = 8000;

/** 私钥缓存有效期：5 分钟，支持证书热更新而不必重启 */
const PRIVATE_KEY_CACHE_TTL_MS = 5 * 60 * 1000;

/** 未配置私钥时的占位签名：请求会被微信拒绝，但不会让本地链路崩溃 */
const DEV_PLACEHOLDER_SIGNATURE = 'DEV_MODE_NO_RSA_KEY';

export interface WechatPayRequestParams {
  method: 'GET' | 'POST';
  /** 实际请求的 url path（不含域名）；路径段里的业务单号必须已编码 */
  urlPath: string;
  /** 收款商户号（平台级），参与鉴权头 */
  mchId: string;
  /**
   * 参与签名的 canonical url path（可含 query）。
   *
   * ⚠️ 微信要求签名使用**未编码**的原始单号，与请求 URL 的编码 path 不是一回事。
   * 只有「确定不含需编码字符」的接口才能省略此项（如 Native 下单）；
   * 涉及 out_trade_no 的关单 / 查单必须显式传入未编码版本。
   */
  signPath?: string;
  /** query 串，不含 `?`；同时参与签名 */
  query?: string;
  /** POST 请求体；GET 时传空串参与签名 */
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
export class PlatformWechatPayHttpService {
  private readonly logger = new Logger(PlatformWechatPayHttpService.name);
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
   * 微信返回 4xx / 5xx 时**不抛异常**，而是返回 `ok: false` 并带回微信错误码，
   * 由调用方按错误码决定语义（例如关单遇到 `ORDERPAID` 意味着用户其实已付款）。
   * 只有网络层不可达才抛 `InternalServerErrorException`。
   */
  async request<T>(
    params: WechatPayRequestParams,
  ): Promise<WechatPayResponse<T>> {
    const canonicalQuery = params.query ? `?${params.query}` : '';
    const requestUrlPath = `${params.urlPath}${canonicalQuery}`;
    const signUrlPath = params.signPath
      ? `${params.signPath}${canonicalQuery}`
      : requestUrlPath;

    const authorization = this.buildAuthorization({
      method: params.method,
      mchId: params.mchId,
      serialNo: this.getRequiredConfig('wechat.mchSerialNo'),
      privateKeyPem: await this.loadPrivateKeyPem(),
      canonicalUrl: signUrlPath,
      body: params.body ?? '',
    });

    const response = await this.send({
      url: `${WECHAT_API_BASE}${requestUrlPath}`,
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

  /** 读取必填配置；缺失直接失败，避免发出注定被微信拒绝的请求 */
  getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new InternalServerErrorException(
        `环境变量 ${key} 未配置，无法发起微信支付`,
      );
    }
    return value.trim();
  }

  /**
   * 加载商户 RSA 私钥 PEM（文件路径 > 内联内容 > 开发态 null），带缓存与并发合并。
   */
  async loadPrivateKeyPem(): Promise<string | null> {
    if (
      this.cachedPrivateKeyPem !== undefined &&
      Date.now() - this.cachedPrivateKeyPemLoadedAt < PRIVATE_KEY_CACHE_TTL_MS
    ) {
      return this.cachedPrivateKeyPem;
    }

    // 缓存失效瞬间的多笔请求会同时走到这里：共用同一次加载，
    // 否则并发度多高就会重复读多少次私钥文件
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
        // GET 没有请求体，不能带 body 字段
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

  // ─── 签名 ─────────────────────────────────────────────────────────────────

  /**
   * 组装 WECHATPAY2-SHA256-RSA2048 鉴权头。
   *
   * 签名串固定 6 段：`{method}\n{canonicalUrl}\n{timestamp}\n{nonce}\n{body}\n`。
   * ⚠️ GET 没有请求体，`body` 为空串，于是末尾是**两个** `\n`
   * （空 body 占一位、结尾换行占一位）。照抄 POST 的拼法会直接签名失败，
   * 而失败信息只有「签名错误」，很难定位到这一行。
   */
  private buildAuthorization(params: {
    method: 'GET' | 'POST';
    mchId: string;
    serialNo: string;
    privateKeyPem: string | null;
    /** 参与签名的 canonical url（不含域名，含 query） */
    canonicalUrl: string;
    /** 请求体原文；GET 为空串 */
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

  private signWithRsa(message: string, privateKeyPem: string | null): string {
    if (!privateKeyPem) {
      this.logger.warn(
        'WECHAT_PAY_PRIVATE_KEY_PATH / WECHAT_PRIVATE_KEY_CONTENT 均未配置，' +
          '使用开发态占位签名，微信将拒绝此请求。',
      );
      return DEV_PLACEHOLDER_SIGNATURE;
    }

    try {
      const privateKey = createPrivateKey(privateKeyPem);
      const sign = createSign('RSA-SHA256');
      sign.update(message, 'utf8');
      return sign.sign(privateKey, 'base64');
    } catch (error) {
      this.logger.error('RSA 签名失败，私钥格式可能有误', error);
      throw new InternalServerErrorException(
        '微信支付签名失败，请检查私钥配置是否正确',
      );
    }
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
        this.logger.error(`读取微信私钥文件失败: ${keyPath}`, error);
        throw new InternalServerErrorException(
          '读取微信支付私钥文件失败，请检查 WECHAT_PRIVATE_KEY_PATH 配置',
        );
      }
    }

    const keyContent = this.configService
      .get<string>('wechat.privateKeyContent')
      ?.trim();
    if (keyContent) {
      const pem = keyContent.replace(/\\n/g, '\n');
      this.cachedPrivateKeyPem = pem;
      return pem;
    }

    this.logger.warn('微信支付私钥未配置，将使用开发态占位签名');
    this.cachedPrivateKeyPem = null;
    return null;
  }
}
