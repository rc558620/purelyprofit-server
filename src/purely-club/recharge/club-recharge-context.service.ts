import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CLUB_MEMBER_NOT_FOUND_MESSAGE } from './club-recharge.constants';

interface ClubRechargeCustomerSnapshot {
  id: number;
}

@Injectable()
export class ClubRechargeContextService {
  constructor(private readonly prisma: PrismaService) {}

  async requireCurrentCustomer(
    storeId: number,
    phone: string,
  ): Promise<ClubRechargeCustomerSnapshot> {
    const customer = await this.prisma.marketingCustomer.findUnique({
      where: {
        storeId_phone: {
          storeId,
          phone,
        },
      },
      select: {
        id: true,
      },
    });

    if (!customer) {
      throw new NotFoundException(CLUB_MEMBER_NOT_FOUND_MESSAGE);
    }

    return customer;
  }
}
