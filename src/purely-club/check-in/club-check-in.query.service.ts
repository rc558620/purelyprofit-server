import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import {
  addShanghaiDays,
  formatShanghaiDate,
} from '../../shared/shanghai-time.utils';
import { ClubPointsQueryService } from '../points/club-points-query.service';
import type { ClubCurrentContext } from '../stores/club-stores.types';
import type {
  ClubCheckInCustomerRecord,
  ClubCheckInPromotionRecord,
} from './club-check-in.types';

/** 签到历史窗口（上海自然日），checkedDates 与连续天数共用同一数据集 */
const CHECK_IN_HISTORY_WINDOW_DAYS = 366;
/** 日期数组上限：一天最多一条，400 条足够覆盖窗口且防止异常数据拖垮响应 */
const CHECK_IN_HISTORY_MAX_ROWS = 400;

@Injectable()
export class ClubCheckInQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clubPointsQueryService: ClubPointsQueryService,
  ) {}

  /** 门店级签到配置：服务层保证含停用态最多一条，按 id 倒序仅作防御 */
  async findPromotion(
    storeId: number,
  ): Promise<ClubCheckInPromotionRecord | null> {
    return this.prisma.marketingPromotion.findFirst({
      where: { storeId, type: 'daily_check_in' },
      select: {
        id: true,
        enabled: true,
        startAt: true,
        endAt: true,
        params: true,
      },
      orderBy: { id: 'desc' },
    });
  }

  /**
   * 顾客档案定位：复用 ClubPointsQueryService 的两段锚定
   * （先 clubUserId，再「phone + clubUserId:null」无主档案，且 deletedAt:null）。
   *
   * 二次按 id + storeId + deletedAt 取审计字段，保证绝不跨店、绝不认领他人档案；
   * 不自动建档，也不写 clubUserId（认领由既有会员建档链路负责）。
   */
  async findCustomer(
    context: ClubCurrentContext,
  ): Promise<ClubCheckInCustomerRecord | null> {
    const storeId = context.store.id;
    const anchored =
      await this.clubPointsQueryService.findCustomerByStoreAndPhone(
        storeId,
        context.user.phone,
        context.user.id,
      );
    if (!anchored) {
      return null;
    }

    return this.prisma.marketingCustomer.findFirst({
      where: { id: anchored.id, storeId, deletedAt: null },
      select: {
        id: true,
        points: true,
        memberId: true,
        clubUserId: true,
      },
    });
  }

  buildHistoryFromDate(serverTime: number): string {
    return formatShanghaiDate(
      addShanghaiDays(serverTime, -CHECK_IN_HISTORY_WINDOW_DAYS),
    );
  }

  /** 按日期升序取近期签到日期，命中 [storeId, customerId, checkInDate] 唯一索引 */
  async listCheckedDates(
    storeId: number,
    customerId: number,
    fromDate: string,
  ): Promise<string[]> {
    const rows = await this.prisma.clubDailyCheckInRecord.findMany({
      where: { storeId, customerId, checkInDate: { gte: fromDate } },
      select: { checkInDate: true },
      orderBy: { checkInDate: 'asc' },
      take: CHECK_IN_HISTORY_MAX_ROWS,
    });
    return rows.map((row) => row.checkInDate);
  }
}
