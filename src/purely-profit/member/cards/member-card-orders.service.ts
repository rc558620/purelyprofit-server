// 商家端售卡订单只读业务：按门店分页列表（状态 / 来源筛选）
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MarketingSharedService } from '../../marketing/marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from '../../marketing/marketing.utils';
import type { ListMemberCardOrdersQueryDto } from './dto/member-card-order-query.dto';
import type { MemberCardOrdersResponseDto } from './dto/member-card-order.response.dto';
import { mapMemberCardOrder } from './member-card-order.mapper';

/**
 * 售卡订单读操作编排层。
 *
 * 口径约定：
 * - 归属：订单属于门店，storeId 一律由访问控制解析（resolveMembershipManagedStoreId），
 *   不信任前端透传值；无可管理门店时返回空页而不是报错；
 * - 只读：本服务不写库，落账与建卡在办卡事务 / C 端支付回调链路内完成；
 * - 排序：createdAt 倒序 + id 倒序，与 (storeId, status, source, createdAt, id)
 *   复合索引一致，避免翻页时出现重复 / 漏行。
 */
@Injectable()
export class MemberCardOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listOrders(
    user: AuthenticatedUser,
    query: ListMemberCardOrdersQueryDto,
  ): Promise<MemberCardOrdersResponseDto> {
    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const storeId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );

    if (storeId === null) {
      return { items: [], ...buildMarketingPaginationMeta(0, page, take) };
    }

    const where = this.buildListWhere(storeId, query);
    const [rows, total] = await Promise.all([
      this.prisma.memberCardOrder.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.memberCardOrder.count({ where }),
    ]);

    return {
      items: rows.map(mapMemberCardOrder),
      ...buildMarketingPaginationMeta(total, page, take),
    };
  }

  /** 列表筛选条件：门店必带，状态 / 来源按需叠加（不传即全部） */
  private buildListWhere(
    storeId: number,
    query: ListMemberCardOrdersQueryDto,
  ): Prisma.MemberCardOrderWhereInput {
    return {
      storeId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
    };
  }
}
