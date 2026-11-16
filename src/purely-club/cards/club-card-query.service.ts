/**
 * C 端卡包查询：当前门店可购卡、我的卡包、卡详情。
 *
 * 读侧不含任何写操作，越权边界由 `ClubCardContextService` 收敛：
 * 卡包 / 卡详情只认「clubUserId 绑定到本人的顾客档案」，
 * 不做手机号降级，避免同号档案把别人的卡展示给我。
 */
import { Injectable, NotFoundException } from '@nestjs/common';
import { CLUB_CARD_ERROR_CODE, clubCardError } from './club-cards.errors';
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
import {
  buildClubKeysetWhere,
  decodeClubCursor,
  encodeClubCursor,
  type ClubCursorKeySpec,
} from '../shared/club-keyset-cursor.util';

/** 前端状态枚举 → 数据库枚举（exhausted 在前端叫 usedUp） */
const toDbCardStatus = (
  status: ClubMemberCardListStatusValue,
): MemberCardStatus => (status === 'usedUp' ? 'exhausted' : status);

/**
 * 卡包列表排序键：`createdAt` 不可变（办卡后不会被写操作刷新），
 * 因此游标位置恒定，翻页不漏不重；末级 id 由工具内置保证全序。
 */
const CARD_LIST_CURSOR_KEYS: ReadonlyArray<ClubCursorKeySpec> = [
  { field: 'createdAt', nullable: false },
];

/** 卡包列表排序（与 CARD_LIST_CURSOR_KEYS 同序：先 createdAt，再由 id 兜底） */
const CARD_LIST_ORDER_BY: Prisma.MemberCardOrderByWithRelationInput[] = [
  { createdAt: 'desc' },
  { id: 'desc' },
];

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
    // 状态派生与筛选共用同一时间基准，避免列表内不同卡片出现跨秒的状态跳变
    const now = new Date();
    const position = decodeClubCursor(query?.cursor, CARD_LIST_CURSOR_KEYS);

    // 状态派生过滤（不含游标）供 total 复用；列表再追加游标条件
    const filters = this.buildListFilters(query?.status, now);
    const where: Prisma.MemberCardWhereInput = {
      customerId: { in: customerIds },
      AND: filters,
    };
    const pageWhere: Prisma.MemberCardWhereInput = position
      ? {
          customerId: { in: customerIds },
          AND: [
            ...filters,
            buildClubKeysetWhere<Prisma.MemberCardWhereInput>(
              CARD_LIST_CURSOR_KEYS,
              position,
            ),
          ],
        }
      : where;

    // 总数只用于展示参考，与当页数据并行发出：不再为两个只读查询独占一个事务连接。
    // count 不叠加游标条件，否则 total 会随翻页递减
    const [total, rows] = await Promise.all([
      this.prisma.memberCard.count({ where }),
      this.prisma.memberCard.findMany({
        where: pageWhere,
        orderBy: CARD_LIST_ORDER_BY,
        // 多取一行判断是否还有下一页：游标由「本页最后一行」编码，末页直接给 null
        take: limit + 1,
        select: CARD_VIEW_SELECT,
      }),
    ]);

    const cards = rows.slice(0, limit);
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
      nextCursor:
        rows.length > limit && cards.length > 0
          ? encodeClubCursor(
              [cards[cards.length - 1].createdAt],
              cards[cards.length - 1].id,
            )
          : null,
      total,
    };
  }

  /**
   * 卡包列表的筛选条件（不含归属与游标）。
   *
   * 状态派生（expired / exhausted）本身是 OR 结构；后续追加的游标条件（多级排序键）
   * 也是 OR——两者必须作为同一个 AND 数组的独立元素，直接 spread 会互相覆盖。
   */
  private buildListFilters(
    status: ClubMemberCardListStatusValue | undefined,
    now: Date,
  ): Prisma.MemberCardWhereInput[] {
    // 已退款的卡不属于「我的卡包」：前端状态枚举也没有 refunded，
    // 不显式筛选时默认隐藏，按状态筛选时才放开
    return [
      status
        ? (buildMemberCardStatusWhere(toDbCardStatus(status), now) ?? {})
        : { status: { not: 'refunded' } },
    ];
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
      throw new NotFoundException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RESOURCE_CARD_NOT_FOUND,
          CLUB_CARD_NOT_FOUND_MESSAGE,
        ),
      );
    }

    const card = await this.prisma.memberCard.findFirst({
      where: { id: cardId, customerId: { in: customerIds } },
      select: CARD_VIEW_SELECT,
    });
    if (!card) {
      throw new NotFoundException(
        clubCardError(
          CLUB_CARD_ERROR_CODE.RESOURCE_CARD_NOT_FOUND,
          CLUB_CARD_NOT_FOUND_MESSAGE,
        ),
      );
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
