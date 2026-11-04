/**
 * 微信支付 API v3 传输层（平台侧 / 门店侧共用）。
 *
 * 抽出的判据是职责而不是行数：私钥加载、鉴权头签名、超时控制、错误响应解析
 * 属于**传输层**，与「这笔钱进谁的账户」无关。
 *
 * ⚠️ 商户身份仍然分开：本文件只接收 `WechatPayCredentialConfig`（配置键名 +
 * 生产态策略），不持有任何具体商户号 / 证书序列号。公共实现收敛到这里，
 * 身份适配留在各自模块。
 */
import { createPrivateKey, createSign, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { InternalServerErrorException } from '@nestjs/common';
import {
  WECHAT_PAY_API_BASE,
  WECHAT_PAY_DEV_PLACEHOLDER_SIGNATURE,
  WECHAT_PAY_PRIVATE_KEY_CACHE_TTL_MS,
  WECHAT_PAY_REQUEST_TIMEOUT_MS,
} from './wechat-pay.constants';
import type {
  WechatPayAuthorizationParts,
  WechatPayErrorPayload,
  WechatPayHttpMethod,
  WechatPayResponse,
  WechatPaySignMessageParts,
  WechatPayTransportOptions,
  WechatPayTransportRequest,
} from './wechat-pay.types';

/**
 * 拼接待签名串：`{method}\n{canonicalUrl}\n{timestamp}\n{nonce}\n{body}\n`。
 *
 * ⚠️ GET 没有请求体，`body` 为空串，于是末尾是**两个** `\n`
 * （空 body 占一位、结尾换行占一位）。照抄 POST 的拼法会直接签名失败，
 * 而失败信息只有「签名错误」，很难定位到这一行。
 */
export function buildWechatPaySignMessage(
  parts: WechatPaySignMessageParts,
): string {
  return [
    parts.method,
    parts.canonicalUrl,
    parts.timestamp,
    parts.nonce,
    parts.body,
    '',
  ].join('\n');
}

/** 拼接 `WECHATPAY2-SHA256-RSA2048` 鉴权头 */
export function buildWechatPayAuthorizationHeader(
  parts: WechatPayAuthorizationParts,
): string {
  return [
    `WECHATPAY2-SHA256-RSA2048 mchid="${parts.mchId}"`,
    `nonce_str="${parts.nonce}"`,
    `signature="${parts.signature}"`,
    `timestamp="${parts.timestamp}"`,
    `serial_no="${parts.serialNo}"`,
  ].join(',');
}

/**
 * 微信支付签名 / 请求发送器。
 *
 * 每个业务模块构造一个实例（而非全局单例），因为私钥缓存与「生产态是否
 * fail-fast」都跟着商户身份走，混用会让两侧的降级策略互相污染。
 */
export class WechatPaySignTransport<TScope extends string = string> {
  /** 私钥缓存与并发去重，按凭据作用域分别保存（不同证书互不影响） */
  private readonly keyCache = new Map<
    TScope,
    { pem: string | null; loadedAt: number }
  >();
  private readonly loadInFlight = new Map<TScope, Promise<string | null>>();

  constructor(private readonly options: WechatPayTransportOptions<TScope>) {}

  /** 是否生产环境：生产禁用一切「签名降级」路径 */
  isProduction(): boolean {
    return (
      (this.options.configService.get<string>('nodeEnv') ?? 'development') ===
      'production'
    );
  }

  /** 读取必填配置；缺失直接失败，避免发出注定被微信拒绝的请求 */
  getRequiredConfig(key: string): string {
    const value = this.options.configService.get<string>(key);
    if (!value?.trim()) {
      throw new InternalServerErrorException(
        `环境变量 ${key} 未配置，无法发起微信支付`,
      );
    }
    return value.trim();
  }

  /**
   * 发起一次微信支付 API v3 请求。
   *
   * 微信返回 4xx / 5xx 时不抛异常，而是返回 `ok: false` 并带回微信错误码，
   * 由调用方按错误码决定语义（例如关单遇到 `ORDERPAID` 意味着用户其实已付款）。
   * 只有网络层不可达才抛 `InternalServerErrorException`。
   */
  async request<T>(
    input: WechatPayTransportRequest<TScope>,
  ): Promise<WechatPayResponse<T>> {
    const scope = input.credential ?? this.options.defaultScope;
    const credential = this.options.resolveCredential(scope);

    const authorization = this.buildAuthorization({
      method: input.method,
      mchId: input.mchId,
      serialNo: this.getRequiredConfig(credential.serialNoKey),
      privateKeyPem: await this.loadPrivateKeyPem(scope),
      canonicalUrl: input.signUrlPath ?? input.requestUrlPath,
      body: input.body ?? '',
    });

    const response = await this.send({
      url: `${WECHAT_PAY_API_BASE}${input.requestUrlPath}`,
      method: input.method,
      authorization,
      body: input.body,
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
      this.options.logger.warn(
        '微信支付私钥未配置，使用开发态占位签名（微信将拒绝此请求）',
      );
      return WECHAT_PAY_DEV_PLACEHOLDER_SIGNATURE;
    }

    try {
      const privateKey = createPrivateKey(privateKeyPem);
      const sign = createSign('RSA-SHA256');
      sign.update(message, 'utf8');
      return sign.sign(privateKey, 'base64');
    } catch (error) {
      this.options.logger.error('RSA 签名失败，商户私钥格式可能有误', error);
      throw new InternalServerErrorException(
        '微信支付签名失败，请检查私钥配置是否正确',
      );
    }
  }

  /**
   * 加载商户 RSA 私钥 PEM（文件路径 > 内联内容 > 开发态 null），带缓存与并发合并。
   *
   * @param scope 凭据作用域，不同作用域各自独立缓存互不影响
   */
  async loadPrivateKeyPem(
    scope: TScope = this.options.defaultScope,
  ): Promise<string | null> {
    const cached = this.keyCache.get(scope);
    if (
      cached !== undefined &&
      Date.now() - cached.loadedAt < WECHAT_PAY_PRIVATE_KEY_CACHE_TTL_MS
    ) {
      return cached.pem;
    }

    // 缓存失效瞬间的多笔请求会同时走到这里：共用同一次加载，
    // 否则并发度多高就会重复读多少次私钥文件
    const inFlight = this.loadInFlight.get(scope);
    if (inFlight) {
      return inFlight;
    }

    const loading = this.loadPrivateKeyPemFromSource(scope).finally(() => {
      this.loadInFlight.delete(scope);
    });
    this.loadInFlight.set(scope, loading);
    return loading;
  }

  // ─── 请求发送与响应解析 ───────────────────────────────────────────────────

  private async send(params: {
    url: string;
    method: WechatPayHttpMethod;
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
        signal: AbortSignal.timeout(WECHAT_PAY_REQUEST_TIMEOUT_MS),
      });
    } catch (error) {
      this.options.logger.error(
        `微信支付接口请求异常 method=${params.method} path=${params.url.replace(WECHAT_PAY_API_BASE, '')}`,
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
  ): Promise<WechatPayErrorPayload | null> {
    try {
      return (await response.json()) as WechatPayErrorPayload;
    } catch {
      return null;
    }
  }

  // ─── 签名 ─────────────────────────────────────────────────────────────────

  /** 组装 WECHATPAY2-SHA256-RSA2048 鉴权头 */
  private buildAuthorization(params: {
    method: WechatPayHttpMethod;
    mchId: string;
    serialNo: string;
    privateKeyPem: string | null;
    canonicalUrl: string;
    body: string;
  }): string {
    const timestamp = String(Math.floor(Date.now() / 1000));
    const nonce = randomBytes(16).toString('hex');

    const signMessage = buildWechatPaySignMessage({
      method: params.method,
      canonicalUrl: params.canonicalUrl,
      timestamp,
      nonce,
      body: params.body,
    });

    return buildWechatPayAuthorizationHeader({
      mchId: params.mchId,
      nonce,
      timestamp,
      signature: this.signWithRsa(signMessage, params.privateKeyPem),
      serialNo: params.serialNo,
    });
  }

  /** 真正读取私钥（文件优先，其次内联），结果写入对应作用域的缓存 */
  private async loadPrivateKeyPemFromSource(
    scope: TScope,
  ): Promise<string | null> {
    const credential = this.options.resolveCredential(scope);
    // 作废旧值但**不能**预写「无密钥」结论：
    // 预写 null 会让 (1) 读取期间到达的并发请求直接命中 null 缓存、跳过 inFlight 合并，
    // (2) 读取失败抛错后 5 分钟内静默降级为占位签名（绕过生产 fail-fast）。
    // 只有确认「确实没有配置密钥」的分支才允许写 null。
    this.keyCache.delete(scope);

    const keyPath = this.options.configService
      .get<string>(credential.privateKeyPathKey)
      ?.trim();
    if (keyPath) {
      try {
        const pem = await readFile(keyPath, 'utf8');
        this.keyCache.set(scope, { pem, loadedAt: Date.now() });
        return pem;
      } catch (error) {
        this.options.logger.error(
          `读取微信支付私钥文件失败: ${keyPath}`,
          error,
        );
        throw new InternalServerErrorException(
          `读取微信支付私钥文件失败，请检查 ${credential.privateKeyPathHint} 配置`,
        );
      }
    }

    const keyContent = this.options.configService
      .get<string>(credential.privateKeyContentKey)
      ?.trim();
    if (keyContent) {
      // 支持环境变量中以字面 \n 代替换行的写法
      const pem = keyContent.replace(/\\n/g, '\n');
      this.keyCache.set(scope, { pem, loadedAt: Date.now() });
      return pem;
    }

    if (this.isProduction() && credential.failFastWhenMissingKeyInProduction) {
      this.options.logger.error(
        '生产环境未配置微信支付商户私钥（privateKeyPath / privateKeyContent），' +
          '拒绝生成支付参数，避免下发注定被微信拒绝的签名',
      );
      throw new InternalServerErrorException(
        '微信支付商户私钥未配置，支付暂不可用，请联系平台管理员',
      );
    }

    this.options.logger.warn('微信支付私钥未配置，将使用开发态占位签名');
    // 确认「未配置」才缓存 null，避免每次请求都重复读配置并刷 warn
    this.keyCache.set(scope, { pem: null, loadedAt: Date.now() });
    return null;
  }
}
