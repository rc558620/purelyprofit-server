// 取出核验策略：P0「取件人是不是本人」的判定集中在此外，便于单测与后续扩展。
//
// 两层防线：
// 1. 店员必须显式勾选「已核对姓名 + 手机号后四位」（后端兜底，前端禁用提交）
// 2. 高风险门店（开关开启或商品单价达阈值）再强制比对手机号后四位
import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import {
  CUSTODY_IDENTITY_UNCHECKED_MESSAGE,
  CUSTODY_PHONE_SUFFIX_INVALID_MESSAGE,
  CUSTODY_PHONE_SUFFIX_REQUIRED_MESSAGE,
  CUSTODY_PHONE_SUFFIX_VERIFIED_REASON_STORE,
  CUSTODY_PHONE_SUFFIX_VERIFIED_REASON_THRESHOLD,
} from './custody.constants';
import { CustodyReadService } from './custody-read.service';

/** 手机号后四位 */
const PHONE_SUFFIX_PATTERN = /^\d{4}$/;

@Injectable()
export class CustodyPickupVerifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly custodyReadService: CustodyReadService,
  ) {}

  /** 未勾选「已核对身份」一律拒绝；前端禁用只是体验，后端才是关口 */
  ensureIdentityChecked(identityChecked: boolean | undefined): void {
    if (identityChecked !== true) {
      throw new BadRequestException(CUSTODY_IDENTITY_UNCHECKED_MESSAGE);
    }
  }

  /**
   * 判定本次核销是否需要核对手机号后四位（只判定，不比对）。
   *
   * 校验取件码阶段用它决定前端是否收起后四位输入框，确认取出阶段用它决定是否强制比对：
   * 两处共用同一判定，避免出现「前端没让店员输、后端却要求输」的错位。
   *
   * @returns 触发原因；未触发时返回 null
   */
  async resolvePhoneVerifyReason(
    storeId: number,
    productId: number | null,
  ): Promise<string | null> {
    const settings = await this.custodyReadService.getSettings(storeId);
    const byThreshold = await this.isOverVerifyThreshold(
      storeId,
      productId,
      settings.pickupPhoneVerifyThreshold,
    );
    if (byThreshold) return CUSTODY_PHONE_SUFFIX_VERIFIED_REASON_THRESHOLD;
    return settings.pickupPhoneVerifyEnabled
      ? CUSTODY_PHONE_SUFFIX_VERIFIED_REASON_STORE
      : null;
  }

  /**
   * 手机号后四位核对（仅在高风险场景强制）：
   * 门店开关开启，或商品单价达到配置阈值时触发。
   *
   * @returns 触发原因；未触发时返回 null（写入审计日志用）
   */
  async verifyPhoneSuffix(
    storeId: number,
    productId: number | null,
    memberPhoneSnapshot: string | null,
    phoneSuffix: string | undefined,
  ): Promise<string | null> {
    const reason = await this.resolvePhoneVerifyReason(storeId, productId);
    if (reason === null) return null;

    const suffix = (phoneSuffix ?? '').trim();
    if (!PHONE_SUFFIX_PATTERN.test(suffix)) {
      throw new BadRequestException(CUSTODY_PHONE_SUFFIX_REQUIRED_MESSAGE);
    }
    if (suffix !== (memberPhoneSnapshot ?? '').slice(-4)) {
      throw new BadRequestException(CUSTODY_PHONE_SUFFIX_INVALID_MESSAGE);
    }
    return reason;
  }

  /** 单价阈值触发：商品单价 ≥ 阈值且存单关联了商品时成立 */
  private async isOverVerifyThreshold(
    storeId: number,
    productId: number | null,
    threshold: number | null,
  ): Promise<boolean> {
    if (threshold === null || productId === null) return false;
    const product = await this.prisma.product.findFirst({
      where: { id: productId, storeId, deletedAt: null },
      select: { price: true },
    });
    return product !== null && product.price >= threshold;
  }
}
