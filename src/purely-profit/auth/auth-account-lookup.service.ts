import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import type {
  AccountIdentifiers,
  AuthProductScope,
  PhoneUserRecord,
} from './auth-account.types';
import type { ProfileUserRecord } from './auth-profile.types';
import { ADMIN_LOGIN_PHONE } from './auth.constants';
import {
  buildAccountLoginEmails,
  buildPhoneLoginEmails,
  resolveLoginEmail,
  resolveLoginPhone,
} from './auth.utils';

@Injectable()
export class AuthAccountLookupService {
  constructor(private readonly prisma: PrismaService) {}

  async findUserByLoginAccount(
    account: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    const loginPhone = resolveLoginPhone(account);
    if (loginPhone) {
      return this.findUserByPhone(loginPhone, productScope);
    }

    const loginEmail = resolveLoginEmail(productScope, account);
    if (!loginEmail) {
      return null;
    }

    return this.findProfitUserByLoginEmails(
      buildAccountLoginEmails('purely_profit', account),
    );
  }

  async findUserByEmail(
    email: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    if (productScope !== 'purely_profit') {
      return null;
    }

    return this.findProfitUserByLoginEmails([email]);
  }

  async findUserByPhone(
    phone: string,
    productScope: AuthProductScope,
  ): Promise<PhoneUserRecord | null> {
    if (phone === ADMIN_LOGIN_PHONE) {
      const developer = await this.findDeveloperUserByPhone(phone);
      if (developer) {
        return developer;
      }
    }

    if (productScope === 'purely_profit') {
      const staff = await this.prisma.staff.findFirst({
        where: {
          phone,
          isActive: true,
          userId: { not: null },
        },
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        select: {
          user: {
            select: {
              id: true,
              email: true,
              password: true,
            },
          },
        },
      });

      if (staff?.user) {
        return {
          ...staff.user,
          phone,
          accountScope: 'purely_profit',
        };
      }
    }

    const candidateEmails = buildPhoneLoginEmails(productScope, phone);
    const user = await this.prisma.user.findFirst({
      where: { email: { in: candidateEmails } },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      return null;
    }

    return {
      ...user,
      phone,
      accountScope: productScope,
    };
  }

  async findProfileUserOrThrow(userId: number): Promise<ProfileUserRecord> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        avatar: true,
        realName: true,
        idNumber: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!user) {
      throw new UnauthorizedException('用户不存在');
    }

    return user;
  }

  async updateAvatar(userId: number, avatar: string | null): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        avatar,
      },
    });
  }

  async verifyRealName(
    userId: number,
    realName: string,
    idNumber: string,
  ): Promise<void> {
    const existingVerifiedUser = await this.prisma.user.findFirst({
      where: {
        idNumber,
        id: { not: userId },
      },
      select: { id: true },
    });

    if (existingVerifiedUser) {
      throw new ConflictException('该身份证号码已完成实名认证');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        realName,
        idNumber,
      },
    });
  }

  async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.prisma.staff.updateMany({
      where: {
        userId: null,
        OR: [{ email: identifiers.email }, { phone: identifiers.phone }],
      },
      data: {
        userId,
      },
    });
  }

  private async findProfitUserByLoginEmails(
    emails: string[],
  ): Promise<PhoneUserRecord | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        email: { in: emails },
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        phone: true,
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });

    if (staff?.user && staff.phone) {
      return {
        ...staff.user,
        phone: staff.phone,
        accountScope: 'purely_profit',
      };
    }

    const user = await this.prisma.user.findFirst({
      where: { email: { in: emails } },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!user) {
      return null;
    }

    const relatedStaff = await this.prisma.staff.findFirst({
      where: {
        userId: user.id,
        isActive: true,
        phone: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: { phone: true },
    });

    if (!relatedStaff?.phone) {
      return null;
    }

    return {
      ...user,
      phone: relatedStaff.phone,
      accountScope: 'purely_profit',
    };
  }

  private async findDeveloperUserByPhone(
    phone: string,
  ): Promise<PhoneUserRecord | null> {
    const staff = await this.prisma.staff.findFirst({
      where: {
        phone,
        isActive: true,
        userId: { not: null },
      },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      select: {
        user: {
          select: {
            id: true,
            email: true,
            password: true,
          },
        },
      },
    });

    if (!staff?.user) {
      return null;
    }

    return {
      ...staff.user,
      phone,
      accountScope: 'developer',
    };
  }
}
