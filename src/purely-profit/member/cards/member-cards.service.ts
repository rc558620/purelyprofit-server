// 商家端持卡实例只读业务：分页列表 / 详情 / 核销流水
// 写操作（手动增减次数）在 member-cards-write.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type MemberCard } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MarketingSharedService } from '../../marketing/marketing-shared.service';
import {
  buildMarketingPaginationMeta,
  resolveMarketingPagination,
} from '../../marketing/marketing.utils';
import type {
  ListMemberCardsQueryDto,
  ListMemberCardTransactionsQueryDto,
} from './dto/member-card-query.dto';
import type {
  MemberCardDto,
  MemberCardsResponseDto,
  MemberCardTransactionsResponseDto,
} from './dto/member-card.response.dto';
import { MEMBER_CARD_CUSTOMER_SEARCH_LIMIT } from './member-card.constants';
import { mapMemberCard, mapMemberCardTransaction } from './member-card.mapper';
import { buildMemberCardStatusWhere } from './member-card-status.query';

/**
 * 持卡读操作编排层。
 *
 * 口径约定：
 * - 归属：持卡属于门店，一律按卡自身 storeId 做权限校验，
 *   不信任前端透传的 storeId / 卡归属；
 * - 顾客：member_cards 与 marketing_customers 之间没有 Prisma 关联字段
 *   （跨模块 schema 不互相牵连），顾客姓名 / 手机号由本层批量反查后回填；
 * - 只读：本服务不写库，写路径见 MemberCardsWriteService。
 */
@Injectable()
export class MemberCardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async listCards(
    user: AuthenticatedUser,
    query: ListMemberCardsQueryDto,
  ): Promise<MemberCardsResponseDto> {
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

    // 筛选与展示共用同一时间基准：跨秒判定会让同一张卡在筛选条件与卡片状态上不一致
    const now = new Date();
    const where = await this.buildListWhere(storeId, query, now);
    const [rows, total] = await Promise.all([
      this.prisma.memberCard.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.memberCard.count({ where }),
    ]);

    return {
      items: await this.buildCardDtos(rows, now.getTime()),
      ...buildMarketingPaginationMeta(total, page, take),
    };
  }

  async getCardDetail(
    user: AuthenticatedUser,
    cardId: number,
  ): Promise<MemberCardDto> {
    const card = await this.getCardOrThrow(cardId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      card.storeId,
      'marketing:view',
    );

    return this.buildCardDto(card);
  }

  async listTransactions(
    user: AuthenticatedUser,
    cardId: number,
    query: ListMemberCardTransactionsQueryDto,
  ): Promise<MemberCardTransactionsResponseDto> {
    const card = await this.getCardOrThrow(cardId);
    await this.marketingSharedService.ensureMarketingStoreAccess(
      user,
      card.storeId,
      'marketing:view',
    );

    const { page, skip, take } = resolveMarketingPagination(
      query.page,
      query.pageSize,
    );
    const where: Prisma.MemberCardTransactionWhereInput = {
      cardId: card.id,
      storeId: card.storeId,
    };
    const [rows, total] = await Promise.all([
      this.prisma.memberCardTransaction.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip,
        take,
      }),
      this.prisma.memberCardTransaction.count({ where }),
    ]);

    return {
      items: rows.map(mapMemberCardTransaction),
      ...buildMarketingPaginationMeta(total, page, take),
    };
  }

  /**
   * 读取持卡行，**不做权限校验**。
   * 供写服务复用：调用方必须先完成 marketing:manage 校验，再调用本方法。
   */
  async getCardOrThrow(cardId: number): Promise<MemberCard> {
    const card = await this.prisma.memberCard.findUnique({
      where: { id: cardId },
    });
    if (!card) {
      throw new NotFoundException('会员卡不存在');
    }

    return card;
  }

  /**
   * 按 ID 组装响应 DTO，**不做权限校验**（同上，调用方负责鉴权）。
   * 写操作完成后用它回读最新次数 / 状态，避免前端拿到写前快照。
   */
  async buildCardDtoById(cardId: number): Promise<MemberCardDto> {
    return this.buildCardDto(await this.getCardOrThrow(cardId));
  }

  /**
   * 列表筛选条件。
   *
   * 状态筛选走 buildMemberCardStatusWhere：过期 / 用尽由服务端派生，
   * 不能只比对 DB 状态，否则「已过期」「次数用尽」两个筛选项永远查不到数据。
   *
   * keyword 需要命中顾客姓名 / 手机号，而 member_cards 没有顾客冗余列：
   * 先按门店把匹配的顾客 ID 收敛成一个上限集，再与卡号 / 卡名做 OR。
   * 两组条件都可能是 OR，统一收进 AND 数组，避免互相覆盖。
   */
  private async buildListWhere(
    storeId: number,
    query: ListMemberCardsQueryDto,
    now: Date,
  ): Promise<Prisma.MemberCardWhereInput> {
    const conditions: Prisma.MemberCardWhereInput[] = [];
    const statusWhere = buildMemberCardStatusWhere(query.status, now);
    if (statusWhere) {
      conditions.push(statusWhere);
    }

    const keyword = query.keyword?.trim();
    if (keyword) {
      const customers = await this.prisma.marketingCustomer.findMany({
        where: {
          storeId,
          deletedAt: null,
          OR: [
            { name: { contains: keyword, mode: 'insensitive' } },
            { phone: { contains: keyword } },
          ],
        },
        select: { id: true },
        take: MEMBER_CARD_CUSTOMER_SEARCH_LIMIT,
      });

      conditions.push({
        OR: [
          { cardNo: { contains: keyword, mode: 'insensitive' } },
          { nameSnapshot: { contains: keyword, mode: 'insensitive' } },
          { customerId: { in: customers.map((item) => item.id) } },
        ],
      });
    }

    return {
      storeId,
      ...(query.kind ? { kind: query.kind } : {}),
      ...(conditions.length > 0 ? { AND: conditions } : {}),
    };
  }

  /** 批量回填顾客信息（姓名 + 脱敏手机号），一次查询覆盖整页 */
  private async buildCardDtos(
    rows: MemberCard[],
    nowMs: number = Date.now(),
  ): Promise<MemberCardDto[]> {
    if (rows.length === 0) {
      return [];
    }

    const customerIds = [...new Set(rows.map((row) => row.customerId))];
    const customers = await this.prisma.marketingCustomer.findMany({
      where: { id: { in: customerIds } },
      select: { id: true, name: true, phone: true },
    });
    const customerMap = new Map(customers.map((item) => [item.id, item]));

    return rows.map((row) =>
      mapMemberCard(row, customerMap.get(row.customerId), nowMs),
    );
  }

  private async buildCardDto(card: MemberCard): Promise<MemberCardDto> {
    const [dto] = await this.buildCardDtos([card]);
    return dto;
  }
}
