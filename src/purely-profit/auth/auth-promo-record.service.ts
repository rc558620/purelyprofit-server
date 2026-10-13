import { Injectable, Logger } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_SHORT } from '../../prisma/prisma.service';
import { CacheInvalidatorService } from '../../redis/invalidator';

/**
 * 注册推广记录创建结果。
 *
 * - created：推广记录已创建
 * - duplicate：同门店同手机号已存在推广记录，跳过创建
 * - invalid_code：推广码无效或已停用（调用方应提示用户）
 * - failed：写入失败（调用方需告警，注册主流程不受影响）
 */
export type PromoRecordCreateResult =
  | { status: 'created'; storeId: number }
  | { status: 'duplicate'; storeId: number }
  | { status: 'invalid_code' }
  | { status: 'failed' };

/**
 * 注册推广记录服务。
 *
 * 职责：
 * - 注册前校验推广码有效性（供调用方提前返回明确错误）
 * - 创建 StoreMembershipPromoRecord（同步执行，保证注册响应前落库）
 * - 创建后失效推广中心缓存，避免推广人数统计滞后
 */
@Injectable()
export class AuthPromoRecordService {
  private readonly logger = new Logger(AuthPromoRecordService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cacheInvalidatorService: CacheInvalidatorService,
  ) {}

  /**
   * 根据推广码解析门店 ID（仅匹配启用中的邀请码）。
   * 返回 null 表示推广码无效或已停用。
   */
  async resolveStoreIdByPromoCode(promoCode: string): Promise<number | null> {
    const inviteCode = await this.prisma.storeInviteCode.findFirst({
      where: {
        code: this.normalizeCode(promoCode),
        isActive: true,
      },
      select: { storeId: true },
    });

    return inviteCode?.storeId ?? null;
  }

  /**
   * 创建推广记录。
   *
   * - storeId 由调用方传入时可跳过一次查码（注册前已校验过）；
   * - 同门店同手机号去重，避免重复注册重试产生多条记录；
   * - 写入失败返回 failed，由调用方告警（注册主流程不回滚）。
   */
  async createPromoRecord(input: {
    promoCode: string;
    inviteePhone: string;
    inviteeName: string;
    storeId?: number | null;
  }): Promise<PromoRecordCreateResult> {
    const storeId =
      input.storeId ?? (await this.resolveStoreIdByPromoCode(input.promoCode));

    if (storeId === null) {
      this.logger.debug(`推广码无效或已停用: ${input.promoCode}`);
      return { status: 'invalid_code' };
    }

    // 去重：同一门店同一被推广手机号只保留一条推广记录
    const existing = await this.prisma.storeMembershipPromoRecord.findFirst({
      where: { storeId, inviteePhone: input.inviteePhone },
      select: { id: true },
    });
    if (existing) {
      this.logger.debug(
        `推广记录已存在，跳过创建: storeId=${storeId}, inviteePhone=${input.inviteePhone}`,
      );
      return { status: 'duplicate', storeId };
    }

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // 查找该门店最早通过的合伙人（无合伙人时 partnerId 为 null，后续可补绑）
          const partner = await tx.storePartner.findFirst({
            where: { storeId, status: 'approved' },
            select: { id: true },
            orderBy: { joinedAt: 'asc' },
          });

          await tx.storeMembershipPromoRecord.create({
            data: {
              storeId,
              partnerId: partner?.id ?? null,
              inviteeName: input.inviteeName || '新用户',
              inviteePhone: input.inviteePhone,
              registeredAt: new Date(),
              hasCharged: false,
            },
          });
        },
        { timeout: TX_TIMEOUT_SHORT },
      );
    } catch (err: unknown) {
      this.logger.error(
        `推广记录创建失败: storeId=${storeId}, inviteePhone=${input.inviteePhone}, error=${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { status: 'failed' };
    }

    // 推广中心/会员中心统计依赖缓存，需主动失效，否则推广人看到的人数不更新
    await this.cacheInvalidatorService.invalidateMembershipDerived(storeId);

    this.logger.log(
      `推广记录已创建: storeId=${storeId}, inviteePhone=${input.inviteePhone}`,
    );
    return { status: 'created', storeId };
  }

  /**
   * 推广码归一化：去空白并转大写（库中统一存大写）。
   */
  private normalizeCode(promoCode: string): string {
    return promoCode.trim().toUpperCase();
  }
}
