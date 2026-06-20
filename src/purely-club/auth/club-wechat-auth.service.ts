/**
 * ClubWechatAuthService
 *
 * 封装微信小程序 code2session 接口：
 *   GET https://api.weixin.qq.com/sns/jscode2session
 *
 * 返回 openid（必有）和 unionid（满足条件时返回）供上层登录/注册使用。
 * 本服务不持久化用户数据，仅负责与微信服务器通信并校验响应合法性。
 */
import {
  Injectable,
  InternalServerErrorException,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RedisService } from '../../redis/redis.service';

export interface WechatCode2SessionResult {
  openid: string;
  unionid?: string;
  /** session_key 仅用于服务端解密，不暴露给前端 */
  sessionKey: string;
}

export interface WechatPhoneNumberResult {
  /** 用户真实手机号（E.164 格式，如 +8613800138000） */
  phoneNumber: string;
  /** 去除 +86 前缀的纯数字手机号（如 13800138000） */
  purePhoneNumber: string;
}

interface WechatCode2SessionRawResponse {
  openid?: string;
  unionid?: string;
  session_key?: string;
  errcode?: number;
  errmsg?: string;
}

interface WechatGetPhoneNumberRawResponse {
  errcode: number;
  errmsg: string;
  phone_info?: {
    phoneNumber: string;
    purePhoneNumber: string;
    countryCode: string;
  };
}

@Injectable()
export class ClubWechatAuthService {
  private readonly logger = new Logger(ClubWechatAuthService.name);

  /** session_key 缓存前缀，key 格式: club:wechat:session_key:{openid} */
  private static readonly SESSION_KEY_CACHE_PREFIX = 'club:wechat:session_key:';
  /** session_key 有效期与微信一致（默认 5 天），这里设 5 天 */
  private static readonly SESSION_KEY_TTL_SECONDS = 5 * 24 * 60 * 60;

  constructor(
    private readonly configService: ConfigService,
    private readonly redisService: RedisService,
  ) {}

  /**
   * 用微信小程序 code 换取 openid / unionid / session_key
   *
   * 错误语义：
   *  - code 无效/过期 → UnauthorizedException（前端重新发起登录）
   *  - 微信服务端异常 → InternalServerErrorException
   */
  async code2session(code: string): Promise<WechatCode2SessionResult> {
    const appId = this.getRequiredConfig('wechat.appId');
    const appSecret = this.getRequiredConfig('wechat.appSecret');

    const url = new URL('https://api.weixin.qq.com/sns/jscode2session');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);
    url.searchParams.set('js_code', code);
    url.searchParams.set('grant_type', 'authorization_code');

    let raw: WechatCode2SessionRawResponse;
    try {
      const response = await fetch(url.toString(), {
        method: 'GET',
        headers: { 'User-Agent': 'purelyprofit-server/1.0' },
      });
      raw = (await response.json()) as WechatCode2SessionRawResponse;
    } catch (error) {
      this.logger.error('微信 code2session 网络请求异常', error);
      throw new InternalServerErrorException(
        '微信登录服务暂时不可用，请稍后重试',
      );
    }

    // 微信 code 无效（40029）或 code 已使用（40163）时给出友好提示
    if (raw.errcode) {
      const isInvalidCode = raw.errcode === 40029 || raw.errcode === 40163;
      if (isInvalidCode) {
        throw new UnauthorizedException(
          '微信登录凭证无效或已过期，请重新发起微信授权',
        );
      }

      this.logger.error(
        `微信 code2session 返回错误 ${raw.errcode}: ${raw.errmsg ?? ''}`,
      );
      throw new InternalServerErrorException(
        `微信登录失败：${raw.errmsg ?? '请联系客服'}`,
      );
    }

    if (!raw.openid || !raw.session_key) {
      this.logger.error(
        `微信 code2session 返回数据异常，缺少 openid 或 session_key: ${JSON.stringify(raw)}`,
      );
      throw new InternalServerErrorException(
        '微信登录返回数据异常，请稍后重试',
      );
    }

    // 缓存 session_key 到 Redis，供后续需要时读取
    await this.redisService.set(
      `${ClubWechatAuthService.SESSION_KEY_CACHE_PREFIX}${raw.openid}`,
      raw.session_key,
      ClubWechatAuthService.SESSION_KEY_TTL_SECONDS,
    );

    return {
      openid: raw.openid,
      unionid: raw.unionid,
      sessionKey: raw.session_key,
    };
  }

  /**
   * 用微信手机号授权 code 换取用户真实手机号
   *
   * 前端通过 Button open-type="getPhoneNumber" 回调中的 e.detail.code 获取 phoneCode，
   * 传给本接口，服务端调用微信 phonenumber.getPhoneNumber 接口解密。
   *
   * 注意：phoneCode 有效期为 5 分钟，且只能使用一次。
   *
   * 错误语义：
   *  - phoneCode 无效/过期 → UnauthorizedException
   *  - 微信服务端异常 → InternalServerErrorException
   */
  async getPhoneNumber(phoneCode: string): Promise<WechatPhoneNumberResult> {
    const appId = this.getRequiredConfig('wechat.appId');
    const accessToken = await this.getAccessToken(appId);

    const url = `https://api.weixin.qq.com/wxa/business/getuserphonenumber?access_token=${accessToken}`;

    let raw: WechatGetPhoneNumberRawResponse;
    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'purelyprofit-server/1.0',
        },
        body: JSON.stringify({ code: phoneCode }),
      });
      raw = (await response.json()) as WechatGetPhoneNumberRawResponse;
    } catch (error) {
      this.logger.error('微信 getPhoneNumber 网络请求异常', error);
      throw new InternalServerErrorException(
        '获取手机号服务暂时不可用，请稍后重试',
      );
    }

    if (raw.errcode !== 0) {
      const isInvalidCode = raw.errcode === 40001 || raw.errcode === 40014;
      if (isInvalidCode) {
        throw new UnauthorizedException(
          '手机号授权凭证无效或已过期，请重新授权',
        );
      }

      this.logger.error(
        `微信 getPhoneNumber 返回错误 ${raw.errcode}: ${raw.errmsg ?? ''}`,
      );
      throw new InternalServerErrorException(
        `获取手机号失败：${raw.errmsg ?? '请联系客服'}`,
      );
    }

    if (!raw.phone_info?.purePhoneNumber) {
      this.logger.error(
        `微信 getPhoneNumber 返回数据异常，缺少 phone_info: ${JSON.stringify(raw)}`,
      );
      throw new InternalServerErrorException(
        '获取手机号返回数据异常，请稍后重试',
      );
    }

    return {
      phoneNumber: raw.phone_info.phoneNumber,
      purePhoneNumber: raw.phone_info.purePhoneNumber,
    };
  }

  private static readonly ACCESS_TOKEN_CACHE_KEY_PREFIX = 'club:wechat:access_token:';
  /** access_token 有效期 7200s，提前 5 分钟刷新以避免边界问题 */
  private static readonly ACCESS_TOKEN_CACHE_TTL_SECONDS = 7200 - 300;

  /**
   * 获取微信小程序 access_token（用于调用 getPhoneNumber 等服务端接口）
   *
   * 优先从 Redis 缓存读取，命中则直接返回；
   * 未命中时调用微信 API 换取新 token 并写入缓存（TTL 6900s，提前 5 分钟过期）。
   */
  private async getAccessToken(appId: string): Promise<string> {
    // 1. 尝试从 Redis 缓存获取
    const cacheKey = ClubWechatAuthService.buildAccessTokenCacheKey(appId);
    const cached = await this.redisService.get(cacheKey);
    if (cached) {
      return cached;
    }

    // 2. 缓存未命中，向微信服务器换取
    const appSecret = this.getRequiredConfig('wechat.appSecret');

    const url = new URL('https://api.weixin.qq.com/cgi-bin/token');
    url.searchParams.set('grant_type', 'client_credential');
    url.searchParams.set('appid', appId);
    url.searchParams.set('secret', appSecret);

    let result: {
      access_token?: string;
      errcode?: number;
      errmsg?: string;
      expires_in?: number;
    };
    try {
      const response = await fetch(url.toString(), {
        headers: { 'User-Agent': 'purelyprofit-server/1.0' },
      });
      result = (await response.json()) as typeof result;
    } catch (error) {
      this.logger.error('微信 getAccessToken 网络请求异常', error);
      throw new InternalServerErrorException('微信服务暂时不可用，请稍后重试');
    }

    if (!result.access_token) {
      this.logger.error(
        `微信 getAccessToken 返回异常: ${JSON.stringify(result)}`,
      );
      throw new InternalServerErrorException('微信服务暂时不可用，请稍后重试');
    }

    // 3. 写入 Redis 缓存
    await this.redisService.set(
      ClubWechatAuthService.buildAccessTokenCacheKey(appId),
      result.access_token,
      ClubWechatAuthService.ACCESS_TOKEN_CACHE_TTL_SECONDS,
    );

    return result.access_token;
  }

  private static buildAccessTokenCacheKey(appId: string): string {
    return `${ClubWechatAuthService.ACCESS_TOKEN_CACHE_KEY_PREFIX}${appId}`;
  }

  private getRequiredConfig(key: string): string {
    const value = this.configService.get<string>(key);
    if (!value?.trim()) {
      throw new InternalServerErrorException(
        `环境变量 ${key} 未配置，无法发起微信登录`,
      );
    }
    return value.trim();
  }
}
