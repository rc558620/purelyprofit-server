import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 注册推广记录服务。
 *
 * 职责：
 * - 注册时根据推广码查找门店与合伙人
 * - 创建 StoreMembershipPromoRecord（异步，不阻塞注册响应）
 */
@Injectable()
export class AuthPromoRecordService {
  private readonly logger = new Logger(AuthPromoRecordService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 注册时尝试创建推广记录。
   * 根据推广码查找 StoreInviteCode → storeId → approvedPartner，
   * 创建 StoreMembershipPromoRecord（hasCharged=false）。
   * 失败时仅打印警告，不影响注册主流程。
   */
  async tryCreatePromoRecord(input: {
    promoCode: string;
    inviteePhone: string;
    inviteeName: string;
  }): Promise<void> {
    // 1. 查找推广码对应的门店
    const inviteCode = await this.prisma.storeInviteCode.findFirst({
      where: {
        code: input.promoCode.toUpperCase(),
        isActive: true,
      },
      select: { storeId: true },
    });
    if (!inviteCode) {
      this.logger.debug(`推广码无效或已停用: ${input.promoCode}`);
      return;
    }

    // 2. 查找该门店的已通过合伙人
    const partner = await this.prisma.storePartner.findFirst({
      where: {
        storeId: inviteCode.storeId,
        status: 'approved',
      },
      select: { id: true },
      orderBy: { joinedAt: 'asc' },
    });

    // 3. 创建推广记录（partnerId 可为 null，后续合伙人审批后可补绑）
    await this.prisma.storeMembershipPromoRecord.create({
      data: {
        storeId: inviteCode.storeId,
        partnerId: partner?.id ?? null,
        inviteeName: input.inviteeName || '新用户',
        inviteePhone: input.inviteePhone,
        registeredAt: new Date(),
        hasCharged: false,
      },
    });

    this.logger.log(
      `推广记录已创建: storeId=${inviteCode.storeId}, inviteePhone=${input.inviteePhone}`,
    );
  }
}
