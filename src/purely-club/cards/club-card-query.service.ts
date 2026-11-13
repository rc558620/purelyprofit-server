/**
 * C 端卡包查询：当前门店可购卡、我的卡包、卡详情。
 *
 * 读侧不含任何写操作，越权边界由 `ClubCardContextService` 收敛：
 * 卡包 / 卡详情只认「clubUserId 绑定到本人的顾客档案」，
 * 不做手机号降级，避免同号档案把别人的卡展示给我。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import type { MemberCardKind, MemberCardStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import { ClubCardContextService } from './club-card-context.service';
import {
  CLUB_CARD_LIST_DEFAULT_LIMIT,
  CLUB_CARD_LIST_MAX_LIMIT,
  CLUB_CARD_NOT_FOUND_MESSAGE,
  CLUB_CARD_USAGE_RECORD_LIMIT,
} from './club-cards.constants';
import { toCardView, toPlanView, toUsageRecordView } from './club-cards.mapper';
import type {
  ClubMemberCardListStatusValue,
  ClubMemberCardPageView,
  ClubMemberCardPlanListView,
  ClubMemberCardView,
} from './club-cards.types';
import { buildMemberCardStatusWhere } from '../../purely-profit/member/cards/member-card-status.query';
import type { ListClubCardsQueryDto } from './dto/club-cards.dto';

/** 前端状态枚举 → 数据库枚举（exhausted 在前端叫 usedUp） */
const toDbCardStatus = (
  status: ClubMemberCardListStatusValue,
): MemberCardStatus => (status === 'usedUp' ? 'exhausted' : status);

/** 游标：前端回传的分页偏移，解析失败按第一页处理 */
const parseOffset = (cursor?: string): number => {
  const parsed = Number(cursor);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
};

/** 卡视图字段白名单：列表与详情共用，避免读取不参与展示的快照/审计列 */
const CARD_VIEW_SELECT = {
  id: true,
  storeId: true,
  planId: true,
  cardNo: true,
  kind: true,
  nameSnapshot: true,
  status: true,
  startsAt: true,
  expiresAt: true,
  totalTimes: true,
  remainTimes: true,
  createdAt: true,
} satisfies Prisma.MemberCardSelect;

@Injectable()
export class ClubCardQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly contextService: ClubCardContextService,
  ) {}

  /** 当前门店可购卡模板（购卡页） */
  async listPlans(
    currentContext: ClubCurrentContext,
    query?: { kind?: MemberCardKind; storeId?: number },
  ): Promise<ClubMemberCardPlanListView> {
    this.contextService.assertStoreMatches(currentContext, query?.storeId);

    const plans = await this.contextService.listAvailablePlans({
      storeId: currentContext.store.id,
      kind: query?.kind,
    });

    // 前端契约是 `{ items }`（与 purelyClub cardService 一致），不是裸数组
    const items = plans.map((plan) =>
      toPlanView({
        id: plan.id,
        kind: plan.kind,
        name: plan.name,
        price: plan.price,
        originalPrice: plan.originalPrice,
        validDays: plan.validDays,
        totalTimes: plan.totalTimes,
        storeName: currentContext.store.name,
      }),
    );

    return { items };
  }

  /** 我的卡包（跨门店，按创建时间倒序） */
  async listMyCards(
    currentContext: ClubCurrentContext,
    query?: ListClubCardsQueryDto,
  ): Promise<ClubMemberCardPageView> {
    const customerIds = await this.contextService.resolveOwnCustomerIds(
      currentContext.user.id,
    );
    if (customerIds.length === 0) {
      return { items: [], nextCursor: null, total: 0 };
    }

    const limit = Math.min(
      query?.limit ?? CLUB_CARD_LIST_DEFAULT_LIMIT,
      CLUB_CARD_LIST_MAX_LIMIT,
    );
    const offset = parseOffset(query?.cursor);
    // 状态派生与筛选共用同一时间基准，避免列表内不同卡片出现跨秒的状态跳变
    const now = new Date();

    const where: Prisma.MemberCardWhereInput = {
      customerId: { in: customerIds },
      // 已退款的卡不属于「我的卡包」：前端状态枚举也没有 refunded，
      // 不显式筛选时默认隐藏，按状态筛选时才放开
      ...(query?.status
        ? (buildMemberCardStatusWhere(toDbCardStatus(query.status), now) ?? {})
        : { status: { not: 'refunded' } }),
    };

    // 同一事务里取总数与当页数据：分页期间新增卡时 total 与 items 不会互相矛盾
    const [total, cards] = await this.prisma.$transaction([
      this.prisma.memberCard.count({ where }),
      this.prisma.memberCard.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: limit,
        select: CARD_VIEW_SELECT,
      }),
    ]);

    const storeNames = await this.contextService.resolveStoreNames(
      cards.map((card) => card.storeId),
    );

    return {
      items: cards.map((card) =>
        toCardView({
          card,
          storeName: storeNames.get(card.storeId) ?? '未知门店',
          now,
        }),
      ),
      // 用「已取条数」判断是否还有下一页，避免为翻页多查一行
      nextCursor:
        offset + cards.length < total ? String(offset + cards.length) : null,
      total,
    };
  }

  /** 卡详情（含最近使用记录） */
  async getCardDetail(
    currentContext: ClubCurrentContext,
    cardId: number,
  ): Promise<ClubMemberCardView> {
    const customerIds = await this.contextService.resolveOwnCustomerIds(
      currentContext.user.id,
    );
    if (customerIds.length === 0) {
      throw new NotFoundException(CLUB_CARD_NOT_FOUND_MESSAGE);
    }

    const card = await this.prisma.memberCard.findFirst({
      where: { id: cardId, customerId: { in: customerIds } },
      select: CARD_VIEW_SELECT,
    });
    if (!card) {
      throw new NotFoundException(CLUB_CARD_NOT_FOUND_MESSAGE);
    }

    const [storeNames, transactions] = await Promise.all([
      this.contextService.resolveStoreNames([card.storeId]),
      this.prisma.memberCardTransaction.findMany({
        where: {
          cardId: card.id,
          // 已取消的开台预扣（reserve → cancelled）次数已由 release 流水回加。
          // 继续展示会被映射成「开台核销 -1」，与「取消开台释放 +1」并列出现，
          // 用户会误以为同一场开台被扣了两次。
          NOT: { status: 'cancelled' },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: CLUB_CARD_USAGE_RECORD_LIMIT,
      }),
    ]);
    const storeName = storeNames.get(card.storeId) ?? '未知门店';

    return toCardView({
      card,
      storeName,
      usageRecords: transactions.map((tx) =>
        toUsageRecordView({ tx, storeName }),
      ),
    });
  }
}
