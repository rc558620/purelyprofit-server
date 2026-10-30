/**
 * 门店收款配置的「子商户绑定校验」（服务商模式）。
 *
 * 从 StoresWechatPayService 拆出来的原因：服务商模式下多了绑定状态机
 * （保存 → 校验 → verified/failed）与一整套微信侧探测逻辑，塞进原服务会让它
 * 突破 400 行，且把「读配置」与「跟微信校验」两件事混在一起。
 *
 * 越权边界：门店一律取自 JWT 上下文（StoresReadService.getBoundStoreRecordOrThrow），
 * 本服务不接受任何 storeId 入参 —— 商家只能校验自己绑定的门店，无法碰别人的配置。
 */
import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatSubMerchantVerifyService } from '../../purely-club/payments/club-wechat-sub-merchant-verify.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { StoresReadService } from './stores-read.service';
import type { WechatPayConfigRecord } from './stores-wechat-pay.types';

/** 绑定校验结论：verified=生效 failed=未绑定/未授权 pending=结果未知，需重试 */
export type BindVerifyOutcome = 'verified' | 'failed' | 'pending';

const RECORD_SELECT = {
  mchId: true,
  mchName: true,
  apiV3KeyEnc: true,
  subMchId: true,
  bindStatus: true,
  bindCheckedAt: true,
  bindFailReason: true,
  configuredAt: true,
} as const;

@Injectable()
export class StoresWechatPayBindService {
  private readonly logger = new Logger(StoresWechatPayBindService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly storesReadService: StoresReadService,
    private readonly configService: ConfigService,
    private readonly subMerchantVerifyService: ClubWechatSubMerchantVerifyService,
  ) {}

  /** 服务商模式是否开启：只有开启时子商户绑定校验才有意义 */
  isPartnerMode(): boolean {
    return this.configService.get<boolean>('wechat.partner.enabled') === true;
  }

  /**
   * 校验当前门店的子商户号与服务商的绑定关系，并把结论写回配置。
   *
   * @returns 更新后的配置记录与校验结论，由调用方统一映射为响应
   */
  async verifyAndPersist(user: AuthenticatedUser): Promise<{
    record: WechatPayConfigRecord;
    outcome: BindVerifyOutcome;
  }> {
    const store = await this.storesReadService.getBoundStoreRecordOrThrow(user);
    const record = await this.prisma.storeWechatPayConfig.findUnique({
      where: { storeId: store.id },
      select: RECORD_SELECT,
    });

    if (!record || !record.subMchId) {
      throw new BadRequestException('请先保存子商户号，再发起绑定校验');
    }
    if (!this.isPartnerMode()) {
      throw new BadRequestException(
        '当前平台未开启服务商收款模式，无需校验子商户绑定关系',
      );
    }

    const result = await this.subMerchantVerifyService.checkBind(
      record.subMchId,
    );
    const outcome: BindVerifyOutcome =
      result.status === 'verified'
        ? 'verified'
        : result.status === 'not_bound'
          ? 'failed'
          : 'pending';

    this.logger.log(
      `门店 ${store.id} 子商户绑定校验（操作人 userId=${user.id}）` +
        ` subMchId=${record.subMchId} 结论=${outcome} 微信码=${result.code ?? 'EMPTY'}`,
    );

    const updated = await this.prisma.storeWechatPayConfig.update({
      where: { storeId: store.id },
      data: {
        bindStatus: outcome,
        bindCheckedAt: new Date(),
        bindFailReason: outcome === 'verified' ? null : result.message,
      },
      select: RECORD_SELECT,
    });

    return { record: updated, outcome };
  }
}
