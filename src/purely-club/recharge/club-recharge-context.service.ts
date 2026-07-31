import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

interface ClubRechargeCustomerSnapshot {
  id: number;
}

@Injectable()
export class ClubRechargeContextService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCurrentCustomer(
    storeId: number,
    clubUserId: number,
    phone: string,
  ): Promise<ClubRechargeCustomerSnapshot> {
    const customer = await this.prisma.marketingCustomer.findFirst({
      where: {
        storeId,
        deletedAt: null,
        OR: [{ clubUserId }, { clubUserId: null, phone }],
      },
      select: {
        id: true,
      },
    });

    if (customer) return customer;

    const user = await this.prisma.user.findUnique({
      where: { id: clubUserId },
      select: { name: true, wechatPhone: true },
    });
    return this.prisma.marketingCustomer.create({
      data: {
        storeId,
        clubUserId,
        name: user?.name?.trim() || 'Club 顾客',
        phone: user?.wechatPhone ?? null,
      },
      select: { id: true },
    });
  }
}
