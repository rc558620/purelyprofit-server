import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { RedisService } from '../../redis/redis.service';
import { buildStoreInviteQrImageDataUrl } from './store-invite-code-qr.utils';

/**
 * 二维码图片缓存 TTL。
 *
 * 出图是**内容寻址**的：payload 不变则 PNG 字节流完全不变，只有轮换邀请码 /
 * 新建渠道码才会产生新 payload → 新 key。因此可以放长 TTL，靠 key 自然淘汰。
 * 上界是「邀请码 + 渠道码」的总数，量级很小，不会无限增长。
 */
const QR_IMAGE_CACHE_TTL_SECONDS = 30 * 24 * 60 * 60;

export function buildStoreInviteQrImageCacheKey(payload: string): string {
  const digest = createHash('sha1').update(payload).digest('hex');
  return `profit:stores:invite-qr:img:${digest}`;
}

/**
 * 进店码二维码出图服务（带缓存）。
 *
 * `QRCode.toDataURL` 是同步 CPU 密集操作：即使签名是 async，PNG 编码期间仍独占
 * 事件循环，直接拖慢同一进程内所有其它请求。调用点有三处，其中渠道码列表
 * `listIssues` 一页最多 50 条 = 单请求最多 50 次同步编码，是最大的毛刺来源。
 *
 * payload → 图片是纯函数且结果不变，因此按 payload 摘要缓存 dataURL：
 * 命中缓存时只剩一次 Redis GET，完全跳过编码。
 *
 * Redis 不可用时必须降级为「直接出图」而不是抛错——出图失败意味着商家拿不到
 * 进店码物料，比慢一点严重得多。
 */
@Injectable()
export class StoreInviteQrImageService {
  private readonly logger = new Logger(StoreInviteQrImageService.name);

  constructor(private readonly redisService: RedisService) {}

  async toImageDataUrl(payload: string): Promise<string> {
    const cacheKey = buildStoreInviteQrImageCacheKey(payload);

    try {
      const cached = await this.redisService.get(cacheKey);
      if (cached) {
        return cached;
      }
    } catch (error: unknown) {
      this.logger.warn(
        `[invite-qr] 读取二维码缓存失败，降级为直接出图: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    const dataUrl = await buildStoreInviteQrImageDataUrl(payload);

    try {
      await this.redisService.set(
        cacheKey,
        dataUrl,
        QR_IMAGE_CACHE_TTL_SECONDS,
      );
    } catch (error: unknown) {
      this.logger.warn(
        `[invite-qr] 写入二维码缓存失败（不影响本次出图）: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return dataUrl;
  }
}
