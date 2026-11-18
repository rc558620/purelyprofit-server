/**
 * 扫码点餐「自动打印」服务端去重。
 *
 * 自动打印此前只在单个页面实例内用 Set 去重：两个终端同时打开工作台并收到
 * 同一条接单事件时，各自都会向同一台打印机下发一次，后厨收到重复小票。
 * 去重必须落在服务端，键为「门店 + 订单 + 打印目标」。
 *
 * 人工重打不参与去重（source=manual）：商家在订单详情里随时可能补打，
 * 那是独立操作，不能被自动打印的占位挡住。
 */
import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../../../redis/redis.service';
import type { CloudPrintTarget } from './scan-ordering-cloud-print.service';

/** 自动打印去重有效期：7 天足够覆盖同一天的重复事件与多终端并发，又不至于长期占键 */
const AUTO_PRINT_DEDUPE_TTL_SECONDS = 7 * 24 * 60 * 60;

const AUTO_PRINT_DEDUPE_PREFIX = 'scan-ordering:print-dedupe:';

@Injectable()
export class ScanOrderingPrintDedupeService {
  private readonly logger = new Logger(ScanOrderingPrintDedupeService.name);

  constructor(private readonly redisService: RedisService) {}

  /**
   * 抢占一次自动打印下发名额。
   *
   * @returns true 表示本次应下发；false 表示已有终端为该订单/目标下发过
   */
  async tryAcquireAutoDispatch(input: {
    storeId: number;
    orderId: number;
    target: CloudPrintTarget;
  }): Promise<boolean> {
    const key = `${AUTO_PRINT_DEDUPE_PREFIX}${input.storeId}:${input.orderId}:${input.target}`;
    try {
      return await this.redisService.setIfAbsent(
        key,
        String(Date.now()),
        AUTO_PRINT_DEDUPE_TTL_SECONDS,
      );
    } catch (error) {
      // Redis 故障时宁可重复打印也不能漏打：放行并留痕，便于事后核对
      this.logger.warn(
        `自动打印去重不可用，按未打印处理: key=${key} reason=${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return true;
    }
  }
}
