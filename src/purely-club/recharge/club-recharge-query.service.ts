import { Injectable, NotFoundException } from '@nestjs/common';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubOrderDraftsService } from '../orders/club-order-drafts.service';
import type {
  ClubOrderDraftPayload,
  ClubRechargeOrderMetadata,
} from '../orders/club-order-drafts.types';
import type { ClubOrderStatusResponseDto } from '../orders/dto/club-order.dto';
import type {
  ClubRechargeOrderResponseDto,
  ClubRechargePackagesResponseDto,
  ListClubRechargePackagesQueryDto,
} from './dto/club-recharge.dto';
import { toClubRechargeOrderResponse } from './club-recharge.mapper';
import { ClubRechargeOrderStoreService } from './club-recharge-order-store.service';
import { ClubRechargePackagesService } from './club-recharge-packages.service';
import { CLUB_RECHARGE_PREVIEW_COUNT } from './club-recharge.constants';

@Injectable()
export class ClubRechargeQueryService {
  constructor(
    private readonly clubRechargePackagesService: ClubRechargePackagesService,
    private readonly clubOrderDraftsService: ClubOrderDraftsService,
    private readonly clubRechargeOrderStoreService: ClubRechargeOrderStoreService,
  ) {}

  async listPackages(
    currentContext: ClubCurrentContext,
    query: ListClubRechargePackagesQueryDto,
  ): Promise<ClubRechargePackagesResponseDto> {
    const packages =
      await this.clubRechargePackagesService.loadPackagesForStore(
        currentContext.store.id,
      );

    return {
      items: query.preview
        ? packages.slice(0, CLUB_RECHARGE_PREVIEW_COUNT)
        : packages,
    };
  }

  async getOrderStatus(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubRechargeOrderResponseDto> {
    const draft = await this.getRechargeDraft(currentContext, orderId);
    return this.toRechargeOrderResponse(draft);
  }

  async getRechargeDraft(
    currentContext: ClubCurrentContext,
    orderId: string,
  ): Promise<ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>> {
    try {
      return await this.clubOrderDraftsService.getDraft(
        currentContext.user,
        orderId,
        'recharge',
      );
    } catch (error) {
      const restored = await this.restoreDraftFromOrderStore(orderId);
      if (!restored) {
        throw error;
      }
      // 订单表按订单号查询，没有用户维度过滤，这里必须补越权校验
      if (restored.userId !== currentContext.user.id) {
        throw new NotFoundException('订单不存在');
      }
      return restored;
    }
  }

  async getRechargeDraftByOrderNo(
    orderNo: string,
  ): Promise<ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>> {
    try {
      return await this.clubOrderDraftsService.getDraftByOrderId(
        orderNo,
        'recharge',
      );
    } catch (error) {
      const restored = await this.restoreDraftFromOrderStore(orderNo);
      if (!restored) {
        throw error;
      }
      return restored;
    }
  }

  /**
   * Redis 草稿丢失（重启 / 淘汰 / 过期）时，按订单号从订单表还原等价草稿。
   * 还原成功后写回 Redis，后续查单与回调复用同一份快照。
   */
  private async restoreDraftFromOrderStore(
    orderNo: string,
  ): Promise<ClubOrderDraftPayload<
    ClubRechargeOrderMetadata,
    'recharge'
  > | null> {
    const snapshot =
      await this.clubRechargeOrderStoreService.findDraftSnapshot(orderNo);

    if (!snapshot) {
      return null;
    }

    await this.clubOrderDraftsService.restoreDraft(snapshot);
    return snapshot;
  }

  toRechargeOrderResponse(
    draft: ClubOrderDraftPayload<ClubRechargeOrderMetadata, 'recharge'>,
  ): ClubRechargeOrderResponseDto {
    const base: ClubOrderStatusResponseDto =
      this.clubOrderDraftsService.toOrderStatusResponse(draft);
    return toClubRechargeOrderResponse(base, draft);
  }
}
