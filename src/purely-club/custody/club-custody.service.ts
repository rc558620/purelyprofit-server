// 客存 C 端门面服务：只做读取与写入的编排转发，不承载任何业务规则
import { Injectable } from '@nestjs/common';
import {
  CUSTODY_DEFAULT_LIMIT,
  CUSTODY_MAX_LIMIT,
} from '../../purely-profit/operations/custody/custody.constants';
import { isSupportedStatusFilter } from '../../purely-profit/operations/custody/custody.query';
import type { CustodyListParams } from '../../purely-profit/operations/custody/custody.types';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCustodyReadService } from './club-custody-read.service';
import { ClubCustodyWriteService } from './club-custody-write.service';
import type {
  ClubCustodyAckResponseDto,
  ClubCustodyOrderDetailResponseDto,
  ClubCustodyOrderListResponseDto,
  ClubCustodyPickupCodeDto,
  ClubCustodyOrderResponseDto,
  ListClubCustodyOrdersQueryDto,
} from './dto/club-custody.dto';

@Injectable()
export class ClubCustodyService {
  constructor(
    private readonly clubCustodyReadService: ClubCustodyReadService,
    private readonly clubCustodyWriteService: ClubCustodyWriteService,
  ) {}

  listOrders(
    context: ClubCurrentContext,
    query: ListClubCustodyOrdersQueryDto,
  ): Promise<ClubCustodyOrderListResponseDto> {
    return this.clubCustodyReadService.listOrders(
      context,
      this.buildListParams(query),
    );
  }

  getOrderDetail(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyOrderDetailResponseDto> {
    return this.clubCustodyReadService.getOrderDetail(context, orderId);
  }

  confirmStore(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyOrderResponseDto> {
    return this.clubCustodyWriteService.confirmStore(context, orderId);
  }

  rejectStore(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    return this.clubCustodyWriteService.rejectStore(context, orderId);
  }

  createPickupCode(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyPickupCodeDto> {
    return this.clubCustodyWriteService.createPickupCode(context, orderId);
  }

  cancelPickupCode(
    context: ClubCurrentContext,
    orderId: number,
  ): Promise<ClubCustodyAckResponseDto> {
    return this.clubCustodyWriteService.cancelPickupCode(context, orderId);
  }

  /** 列表入参归一：默认全部（草稿与作废由读服务兜底剔除） */
  private buildListParams(
    query: ListClubCustodyOrdersQueryDto,
  ): Omit<CustodyListParams, 'storeId'> {
    const status =
      query.status && isSupportedStatusFilter(query.status)
        ? query.status
        : 'all';
    return {
      status,
      // 个人端列表暂不开放到期预警筛选，固定关闭
      expiring: false,
      keyword: '',
      cursor: query.cursor,
      limit: Math.min(
        Math.max(query.limit ?? CUSTODY_DEFAULT_LIMIT, 1),
        CUSTODY_MAX_LIMIT,
      ),
    };
  }
}
