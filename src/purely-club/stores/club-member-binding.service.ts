import { Injectable } from '@nestjs/common';
import { PrismaService, TX_TIMEOUT_MEDIUM } from '../../prisma/prisma.service';

/** 入店绑定结果：isNewMember 表示会员档案是否本次首次创建（用于渠道拉新计数） */
export interface ClubMemberBindingResult {
  isNewMember: boolean;
}

/**
 * 门店会员档案绑定服务。
 *
 * 负责用户加入门店时的事务化档案同步：
 * - Member 档案：存在则更新昵称，不存在则创建；
 * - MarketingCustomer 档案：存在则更新昵称，不存在则创建；
 * - 返回是否为新会员，供渠道拉新归因使用。
 */
@Injectable()
export class ClubMemberBindingService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * 在事务内同步 Member / MarketingCustomer 档案。
   *
   * 同一门店 + 手机号维度幂等：已存在档案只更新昵称，不重复创建。
   */
  async upsertMemberAndCustomer(
    storeId: number,
    phone: string,
    displayName: string,
  ): Promise<ClubMemberBindingResult> {
    let isNewMember = false;

    await this.prisma.$transaction(
      async (tx) => {
        const existingMemberRecord = await tx.member.findFirst({
          where: {
            storeId,
            phone,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (existingMemberRecord) {
          await tx.member.update({
            where: { id: existingMemberRecord.id },
            data: {
              name: displayName,
            },
          });
        } else {
          await tx.member.create({
            data: {
              storeId,
              name: displayName,
              phone,
            },
          });
          isNewMember = true;
        }

        const existingCustomerRecord = await tx.marketingCustomer.findFirst({
          where: {
            storeId,
            phone,
            deletedAt: null,
          },
          select: {
            id: true,
          },
        });

        if (existingCustomerRecord) {
          await tx.marketingCustomer.update({
            where: { id: existingCustomerRecord.id },
            data: {
              name: displayName,
            },
          });
        } else {
          await tx.marketingCustomer.create({
            data: {
              storeId,
              name: displayName,
              phone,
            },
          });
        }
      },
      { timeout: TX_TIMEOUT_MEDIUM },
    );

    return { isNewMember };
  }
}
