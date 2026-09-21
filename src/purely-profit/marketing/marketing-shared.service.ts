import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import type { ClubMemberLevelValue } from '../../purely-club/member/dto/club-member-account.dto';
import { ClubMemberLevelsService } from '../../purely-club/member/member-levels/club-member-levels.service';
import { ClubMemberProfileService } from '../../purely-club/member/member-profile/club-member-profile.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { PrismaService } from '../../prisma/prisma.service';
import type { MarketingPermission } from './marketing-access.service';
import { MarketingAccessService } from './marketing-access.service';
import { queryCustomerRowById, queryPromotionRowById } from './marketing.query';
import type {
  MarketingCustomerRow,
  MarketingProductCategoryRow,
  MarketingProductRow,
  MarketingPromotionRow,
} from './marketing.types';
import type { MarketingCustomerDetailDto } from './dto/marketing-response.dto';
import { normalizePhone } from './marketing.utils';

@Injectable()
export class MarketingSharedService {
  private readonly logger = new Logger(MarketingSharedService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accessService: MarketingAccessService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly clubMemberProfileService: ClubMemberProfileService,
    private readonly clubMemberLevelsService: ClubMemberLevelsService,
  ) {}

  async resolveMembershipManagedStoreId(
    user: AuthenticatedUser,
    storeId?: number,
  ): Promise<number | null> {
    const resolvedStoreId = await this.accessService.resolveViewStoreId(
      user,
      storeId,
    );
    if (resolvedStoreId !== null) {
      const callerIsSubAccount =
        user.currentMembership?.subjectType === 'sub_account';
      await this.platformMembershipAccessService.ensureMarketingFeatureEnabled(
        resolvedStoreId,
        callerIsSubAccount,
      );
    }
    return resolvedStoreId;
  }

  async ensureMarketingStoreAccess(
    user: AuthenticatedUser,
    storeId: number,
    permission: MarketingPermission,
  ): Promise<void> {
    await this.accessService.ensureCanAccess(user, storeId, permission);
    const callerIsSubAccount =
      user.currentMembership?.subjectType === 'sub_account';
    await this.platformMembershipAccessService.ensureMarketingFeatureEnabled(
      storeId,
      callerIsSubAccount,
    );
  }

  /**
   * 解析顾客在 purelyClub 侧的会员等级。
   *
   * phone 有三态：真实手机号 / `club_wechat:{openid}` 占位值 / null。
   * 占位值无法被 normalizePhone 归一化（会被判成非法并返回 null），因此不能
   * 先归一化再查——否则扫码建档的顾客永远匹配不到 Member。这里按候选值原样
   * 逐个尝试，phone 缺失时再用 clubUserId 反查 users.wechat_phone 兜底。
   */
  async resolveClubLevel(
    storeId: number,
    phone: string | null,
    clubUserId?: number | null,
  ): Promise<Pick<MarketingCustomerDetailDto, 'clubLevel' | 'clubLevelLabel'>> {
    const candidates = await this.resolveClubLookupPhones(phone, clubUserId);
    if (candidates.length === 0) {
      return {};
    }

    try {
      for (const candidate of candidates) {
        const snapshot =
          await this.clubMemberProfileService.getSnapshotByStoreAndPhone(
            storeId,
            candidate,
          );
        if (!snapshot) {
          continue;
        }

        const currentLevelConfig =
          await this.clubMemberLevelsService.resolveCurrentLevelConfig(
            snapshot,
          );

        return {
          clubLevel: currentLevelConfig.level as ClubMemberLevelValue,
          clubLevelLabel: currentLevelConfig.label,
        };
      }
      return {};
    } catch (err) {
      // B3: clubLevel 是附加字段，解析失败不应阻断核心数据返回
      this.logger.warn(
        `resolveClubLevel failed for storeId=${storeId}, candidates=${candidates.length}: ${err instanceof Error ? err.message : err}`,
      );
      return {};
    }
  }

  /** 生成用于 club 会员匹配的候选手机号（按优先级去重） */
  private async resolveClubLookupPhones(
    phone: string | null,
    clubUserId?: number | null,
  ): Promise<string[]> {
    const candidates: string[] = [];
    const push = (value: string | null | undefined): void => {
      const trimmed = value?.trim();
      if (trimmed && !candidates.includes(trimmed)) {
        candidates.push(trimmed);
      }
    };

    push(phone);
    // B2: 再补一份归一化值，兼容库里存了带 +86 / 空格的格式
    push(normalizePhone(phone));

    if (clubUserId) {
      const user = await this.prisma.user.findUnique({
        where: { id: clubUserId },
        select: { wechatPhone: true },
      });
      push(user?.wechatPhone);
    }

    return candidates;
  }

  /**
   * D1: 手机号校验——区分「未填/空串=清除」与「非法格式=400 拒绝」。
   * - undefined / '' → 返回 null（表示清除）
   * - 非空但 normalizePhone 返回 null → 抛 400
   * - 合法手机号 → 返回归一化后的手机号
   */
  validatePhoneOrThrow(phone: string | undefined): string | null {
    if (phone === undefined || phone === '') {
      return null;
    }
    const normalized = normalizePhone(phone);
    if (!normalized) {
      throw new BadRequestException('手机号格式不正确，请输入 11 位国内手机号');
    }
    return normalized;
  }

  async ensureUniquePhone(
    storeId: number,
    phone: string | null | undefined,
    excludeCustomerId?: number,
  ): Promise<void> {
    const normalizedPhone = phone?.trim();
    if (!normalizedPhone) {
      return;
    }

    const existing = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        phone: normalizedPhone,
        deletedAt: null,
      },
      select: { id: true },
    });
    if (existing && existing.id !== excludeCustomerId) {
      throw new ConflictException('该手机号的顾客已存在');
    }
  }

  async findCustomerOrThrow(customerId: number): Promise<MarketingCustomerRow> {
    const customer = await queryCustomerRowById(this.prisma, customerId);
    if (!customer) {
      throw new NotFoundException('顾客不存在');
    }
    return customer;
  }

  async findPromotionOrThrow(
    promotionId: number,
  ): Promise<MarketingPromotionRow> {
    const promotion = await queryPromotionRowById(this.prisma, promotionId);
    if (!promotion) {
      throw new NotFoundException('活动不存在');
    }
    return promotion;
  }

  async findProductCategoryOrThrow(
    categoryId: number,
  ): Promise<MarketingProductCategoryRow> {
    const category = await this.prisma.marketingProductCategory.findUnique({
      where: { id: categoryId },
    });
    if (!category) {
      throw new NotFoundException('产品分类不存在');
    }
    return category;
  }

  async findProductOrThrow(productId: number): Promise<MarketingProductRow> {
    const product = await this.prisma.marketingProduct.findUnique({
      where: { id: productId },
      include: {
        category: {
          select: {
            name: true,
          },
        },
      },
    });
    if (!product) {
      throw new NotFoundException('产品不存在');
    }

    return {
      id: product.id,
      storeId: product.storeId,
      categoryId: product.categoryId,
      categoryName: product.category?.name ?? '',
      name: product.name,
      price: product.price,
      originalPrice: product.originalPrice,
      image: product.image,
      descriptionTitle: product.descriptionTitle,
      description: product.description,
      stock: product.stock,
      durationMinutes: product.durationMinutes,
      personCount: product.personCount,
      unit: product.unit,
      type: product.type,
      validDays: product.validDays,
      billingMode: product.billingMode,
      hourlyRate: product.hourlyRate,
      countdownMinutes: product.countdownMinutes,
      countdownPrice: product.countdownPrice,
      autoCheckout: product.autoCheckout,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }
}
