// 开台识别（聚合读）：按当前门店 + 手机号精确匹配营销顾客，
// 聚合「顾客信息 / 储值余额 / 可用持卡 / 可用团购券」
//
// 口径约定：
// - 归属：门店一律由当前登录者的可管理门店解析，不信任前端透传的门店归属；
// - 匹配：手机号先归一化再做**精确**匹配（不做模糊搜索，避免收银台识别到别人）；
// - 只读：本服务不写库，也不返回消费明细 / 积分明细等与开台无关的账务流水；
// - 空态：未匹配到顾客不抛 404，返回空资产聚合，由前端回落到「抵扣不可用」。
import { Injectable } from '@nestjs/common';
import type { MemberCard } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';
import { Money } from '../../../shared/money.utils';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MarketingSharedService } from '../../marketing/marketing-shared.service';
import type { IdentifyMemberCardQueryDto } from './dto/identify-member-card.query.dto';
import type { MemberCardIdentifyResponseDto } from './dto/member-card-identify.response.dto';
import {
  MEMBER_CARD_IDENTIFY_CARDS_LIMIT,
  MEMBER_CARD_IDENTIFY_USABLE_VOUCHER_STATUSES,
  MEMBER_CARD_IDENTIFY_VOUCHERS_LIMIT,
} from './member-card.constants';
import {
  mapMemberCard,
  mapMemberVoucherAsset,
  type MemberVoucherAssetSnapshot,
} from './member-card.mapper';
import { resolveDisplayPhone } from './member-card.utils';

/** 识别命中的顾客行：只取开台需要的列，避免把整份顾客档案读进内存 */
interface IdentifyCustomerRow {
  id: number;
  name: string;
  phone: string | null;
  balance: number;
  clubUserId: number | null;
}

/**
 * 未命中顾客时的空聚合。
 *
 * 结账面板按「有无 customerId」判定会员是否可用；这里返回 200 + 空资产，
 * 比抛 404 更贴合前端语义（非会员到店消费是正常场景，不是异常）。
 */
function buildEmptyIdentifyResult(): MemberCardIdentifyResponseDto {
  return { balance: 0, cards: [], vouchers: [] };
}

@Injectable()
export class MemberCardIdentifyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly marketingSharedService: MarketingSharedService,
  ) {}

  async identify(
    user: AuthenticatedUser,
    query: IdentifyMemberCardQueryDto,
  ): Promise<MemberCardIdentifyResponseDto> {
    const storeId =
      await this.marketingSharedService.resolveMembershipManagedStoreId(
        user,
        query.storeId,
      );
    // 归一化在前、查库在后：带 +86 / 空格的写法也要能命中同一位顾客
    const phone = this.marketingSharedService.validatePhoneOrThrow(query.phone);

    if (storeId === null || phone === null) {
      return buildEmptyIdentifyResult();
    }

    const customer = await this.findCustomerByPhone(storeId, phone);
    if (!customer) {
      return buildEmptyIdentifyResult();
    }

    const nowMs = Date.now();
    const [cards, vouchers, clubLevel] = await Promise.all([
      this.findUsableCards(storeId, customer.id, nowMs),
      this.findUsableVouchers(storeId, customer.id, phone, nowMs),
      this.marketingSharedService.resolveClubLevel(
        storeId,
        customer.phone,
        customer.clubUserId,
      ),
    ]);
    const customerSnapshot = { name: customer.name, phone: customer.phone };

    return {
      customerId: String(customer.id),
      name: customer.name,
      phone: resolveDisplayPhone(customer.phone),
      clubLevelLabel: clubLevel.clubLevelLabel,
      balance: Money.fromDbCents(customer.balance).toOutputYuan(),
      cards: cards.map((card) => mapMemberCard(card, customerSnapshot, nowMs)),
      vouchers: vouchers.map(mapMemberVoucherAsset),
    };
  }

  /**
   * 门店内按手机号精确匹配顾客。
   *
   * marketing_customers 没有 storeId + phone 唯一约束（历史原因），同店同号可能
   * 存在多条；固定取最新一条，保证收银台每次识别到的是同一份档案。
   */
  private findCustomerByPhone(
    storeId: number,
    phone: string,
  ): Promise<IdentifyCustomerRow | null> {
    return this.prisma.marketingCustomer.findFirst({
      where: { storeId, phone, deletedAt: null },
      orderBy: [{ id: 'desc' }],
      select: {
        id: true,
        name: true,
        phone: true,
        balance: true,
        clubUserId: true,
      },
    });
  }

  /**
   * 可用持卡：状态生效 + 未到期 + 次数卡仍有剩余次数。
   *
   * 到期巡检任务尚未落地，status 可能滞后停留在 active，因此这里必须再按
   * expiresAt 兜一层，避免把已过期的卡列进开台下拉。
   */
  private findUsableCards(
    storeId: number,
    customerId: number,
    nowMs: number,
  ): Promise<MemberCard[]> {
    return this.prisma.memberCard.findMany({
      where: {
        storeId,
        customerId,
        status: 'active',
        AND: [
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(nowMs) } }] },
          { OR: [{ remainTimes: null }, { remainTimes: { gt: 0 } }] },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MEMBER_CARD_IDENTIFY_CARDS_LIMIT,
    });
  }

  /**
   * 可用团购券：门店一致、已支付待使用、券码已生成、未过期。
   *
   * 归属判定同时看两条线——订单落库时的 customerId 是权威归属，
   * guestPhone 快照用于覆盖「C 端下单时顾客档案刚换绑」的极窄窗口。
   */
  private findUsableVouchers(
    storeId: number,
    customerId: number,
    phone: string,
    nowMs: number,
  ): Promise<MemberVoucherAssetSnapshot[]> {
    return this.prisma.clubVoucherOrder.findMany({
      where: {
        storeId,
        status: { in: [...MEMBER_CARD_IDENTIFY_USABLE_VOUCHER_STATUSES] },
        voucherCode: { not: null },
        AND: [
          { OR: [{ customerId }, { guestPhone: phone }] },
          { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(nowMs) } }] },
        ],
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: MEMBER_CARD_IDENTIFY_VOUCHERS_LIMIT,
      select: {
        voucherCode: true,
        productName: true,
        paidAmountFen: true,
        expiresAt: true,
      },
    });
  }
}
