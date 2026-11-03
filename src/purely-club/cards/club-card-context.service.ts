/**
 * C 端购卡链路的上下文解析：当前门店的可售卡模板、本人顾客档案、卡归属校验。
 *
 * 越权边界全在这里：
 * - 卡模板必须属于**当前门店**且未下架未删除，不接受跨店 ID；
 * - 顾客档案必须锚定「当前登录者本人的 clubUserId」，手机号降级匹配也
 *   只认 `clubUserId IS NULL` 的历史无主档案（与团购券下单同一口径）。
 */
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { MemberCardKind, MemberCardPlan, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildClubMemberDisplayName,
  getDisplayPhone,
} from '../../purely-profit/auth/auth.utils';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import {
  CLUB_CARD_CUSTOMER_NOT_FOUND_MESSAGE,
  CLUB_CARD_PLAN_NOT_FOUND_MESSAGE,
  CLUB_CARD_STORE_CHANGED_MESSAGE,
} from './club-cards.constants';

/** 本人顾客档案摘要（下单落库与快照用） */
export interface ClubCardCustomerSnapshot {
  id: number;
  /** 顾客姓名快照：昵称优先，否则按手机号派生展示名 */
  guestName: string | null;
  /** 顾客手机号快照：占位手机号不留存 */
  guestPhone: string | null;
}

/** 可售卡模板 + 所属门店名 */
export interface ClubCardPlanContext {
  plan: MemberCardPlan;
  storeName: string;
}

@Injectable()
export class ClubCardContextService {
  constructor(private readonly prisma: PrismaService) {}

  /** 校验请求里的门店与当前门店一致（防止切换门店后旧页面继续下单） */
  assertStoreMatches(
    currentContext: ClubCurrentContext,
    storeId?: number,
  ): void {
    if (storeId !== undefined && storeId !== currentContext.store.id) {
      throw new BadRequestException(CLUB_CARD_STORE_CHANGED_MESSAGE);
    }
  }

  /** 当前门店可购卡模板列表（上架 + 未删除；可按卡类型筛选） */
  async listAvailablePlans(params: {
    storeId: number;
    kind?: MemberCardKind;
  }): Promise<MemberCardPlan[]> {
    return this.prisma.memberCardPlan.findMany({
      where: {
        storeId: params.storeId,
        isActive: true,
        deletedAt: null,
        ...(params.kind ? { kind: params.kind } : {}),
      },
      // 价格升序：购卡页 Tab 内按档位从低到高，排序在 SQL 侧完成避免内存抖动
      orderBy: [{ price: 'asc' }, { id: 'asc' }],
    });
  }

  /** 当前门店的单张可购卡模板 */
  async resolvePlan(
    currentContext: ClubCurrentContext,
    planId: number,
  ): Promise<ClubCardPlanContext> {
    const plan = await this.prisma.memberCardPlan.findFirst({
      where: {
        id: planId,
        storeId: currentContext.store.id,
        isActive: true,
        deletedAt: null,
      },
    });

    if (!plan) {
      throw new NotFoundException(CLUB_CARD_PLAN_NOT_FOUND_MESSAGE);
    }

    return { plan, storeName: currentContext.store.name };
  }

  /**
   * 定位**当前登录者本人**在当前门店的顾客档案。
   *
   * 两步顺序不可颠倒（与团购券下单一致）：
   * 1. (storeId, clubUserId) 权威锚点；
   * 2. 锚点落空才按手机号降级，且必须限定 clubUserId 为 null，
   *    否则可能把同店同号的他人档案（及其余额 / 卡包）当成自己的。
   */
  async resolveOwnCustomer(
    currentContext: ClubCurrentContext,
  ): Promise<ClubCardCustomerSnapshot> {
    const storeId = currentContext.store.id;
    const clubUserId = currentContext.user.id;

    const bound = await this.prisma.marketingCustomer.findFirst({
      where: { storeId, clubUserId, deletedAt: null },
      select: { id: true },
    });

    const customer =
      bound ??
      (await this.prisma.marketingCustomer.findFirst({
        where: {
          storeId,
          phone: currentContext.user.phone,
          clubUserId: null,
          deletedAt: null,
        },
        select: { id: true },
      }));

    if (!customer) {
      throw new NotFoundException(CLUB_CARD_CUSTOMER_NOT_FOUND_MESSAGE);
    }

    const phone = currentContext.user.phone ?? '';
    return {
      id: customer.id,
      guestName: buildClubMemberDisplayName(phone, currentContext.user.name),
      guestPhone: getDisplayPhone(phone) || null,
    };
  }

  /**
   * 当前登录者本人名下的全部顾客档案 ID（跨门店）。
   *
   * 卡包是「我的卡」而不是「本店我买的卡」：用户可能在 A 店买卡、B 店查看，
   * 因此按 clubUserId 聚合所有门店的档案；不含手机号降级匹配——
   * 无主档案无法证明归属，不能因为同号就把别人的卡放进我的卡包。
   */
  async resolveOwnCustomerIds(clubUserId: number): Promise<number[]> {
    const customers = await this.prisma.marketingCustomer.findMany({
      where: { clubUserId, deletedAt: null },
      select: { id: true },
    });
    return customers.map((item) => item.id);
  }

  /** 门店名映射（卡包跨门店，需按 storeId 回查名称） */
  async resolveStoreNames(storeIds: number[]): Promise<Map<number, string>> {
    const uniqueIds = [...new Set(storeIds)];
    if (uniqueIds.length === 0) {
      return new Map();
    }

    const stores = await this.prisma.store.findMany({
      where: { id: { in: uniqueIds } },
      select: { id: true, name: true },
    });
    return new Map(stores.map((store) => [store.id, store.name]));
  }

  /** 购卡笔数（每人限购校验用；已退款不计入） */
  async countOwnedCards(
    tx: Prisma.TransactionClient | PrismaService,
    params: { customerId: number; planId: number },
  ): Promise<number> {
    return tx.memberCard.count({
      where: {
        customerId: params.customerId,
        planId: params.planId,
        status: { not: 'refunded' },
      },
    });
  }
}
