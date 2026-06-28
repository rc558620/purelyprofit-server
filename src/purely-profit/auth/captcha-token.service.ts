// 拼图验证令牌服务：校验前端拼图验证通过后传入的 captchaToken
// 当前为 MVP 实现：校验 token 格式合法且未过期
// 后续可升级为：后端颁发 challenge → 前端完成 → 后端校验 challenge 完整闭环
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';

/** captchaToken Redis key 前缀 */
const CAPTCHA_TOKEN_KEY_PREFIX = 'auth:captcha-token:';
/** captchaToken 有效期（秒），拼图验证完成后 5 分钟内需发送短信 */
const CAPTCHA_TOKEN_TTL_SECONDS = 300;

/**
 * 校验 captchaToken 格式
 *
 * 前端 usePuzzleCaptcha 生成的 token 格式为 `puzzle_{timestamp}_{counter}`
 * 格式校验确保 token 不是随机字符串或注入攻击
 */
const CAPTCHA_TOKEN_PATTERN = /^puzzle_\d+_\d+$/;

@Injectable()
export class CaptchaTokenService {
  private readonly logger = new Logger(CaptchaTokenService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 校验并消费 captchaToken
   *
   * 逻辑：
   * 1. 未传 captchaToken → 拒绝请求（生产环境强制要求）
   * 2. 格式不合法 → 拒绝请求
   * 3. Token 已被消费（Redis 中不存在）→ 拒绝请求
   * 4. Token 有效 → 从 Redis 中删除（一次性消费），允许发送短信
   *
   * @param captchaToken 前端传入的拼图验证令牌
   * @throws captchaToken 无效时抛出 BadRequestException
   */
  async validateAndConsume(captchaToken: string | undefined): Promise<void> {
    // 未传 token：拒绝请求
    if (!captchaToken) {
      throw new BadRequestException('请先完成人机验证');
    }

    // 格式校验
    if (!CAPTCHA_TOKEN_PATTERN.test(captchaToken)) {
      this.logger.warn(
        `captchaToken 格式不合法: ${captchaToken.substring(0, 20)}...`,
      );
      throw new BadRequestException('人机验证令牌格式不合法');
    }

    // 一次性消费：从 Redis 中删除 token
    const redisKey = `${CAPTCHA_TOKEN_KEY_PREFIX}${captchaToken}`;
    const existing = await this.redisService.get(redisKey);

    if (!existing) {
      // token 不存在（已消费或已过期）
      throw new BadRequestException('人机验证已过期，请重新验证');
    }

    // 删除 token，确保一次性使用
    await this.redisService.del(redisKey);
  }

  /**
   * 颁发 captchaToken（供前端调用验证码接口时使用）
   *
   * 将 token 存入 Redis 并设置 TTL，后续发送短信时校验并消费。
   *
   * @param captchaToken 前端生成的拼图验证令牌
   */
  async issue(captchaToken: string): Promise<void> {
    const redisKey = `${CAPTCHA_TOKEN_KEY_PREFIX}${captchaToken}`;
    await this.redisService.set(redisKey, '1', CAPTCHA_TOKEN_TTL_SECONDS);
  }
}
