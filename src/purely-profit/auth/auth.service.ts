import {
  BadRequestException,
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { StaffStatus, type Prisma } from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { AccessControlService } from '../access-control/access-control.service';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import {
  AUTH_PASSWORD_RESET_CODE_KEY_PREFIX,
  AUTH_PASSWORD_RESET_CODE_LENGTH,
  AUTH_REGISTER_CODE_KEY_PREFIX,
  AUTH_TOKEN_VERSION_KEY_PREFIX,
  DEFAULT_PASSWORD_RESET_CODE_TTL_SECONDS,
  DEFAULT_REGISTER_CODE_TTL_SECONDS,
} from './auth.constants';
import { AuthSmsService } from './auth-sms.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ForgotPasswordResponseDto } from './dto/forgot-password-response.dto';
import { LoginDto } from './dto/login.dto';
import { PasswordOperationResponseDto } from './dto/password-operation-response.dto';
import { ProfileResponseDto } from './dto/profile-response.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { SendRegisterCodeResponseDto } from './dto/send-register-code-response.dto';
import { UpdateAvatarDto } from './dto/update-avatar.dto';
import { VerifyRealNameDto } from './dto/verify-real-name.dto';
import {
  buildStoreResponseDto,
  normalizeStoreProfileMetadata,
  type StoreProfileMetadata,
} from '../stores/dto/store-response.dto';
import { toNullableMediaText, toOptionalMediaText } from '../commerce/commerce.utils';
import type { AuthenticatedUser, JwtPayload } from './strategies/jwt.strategy';

type MembershipRole = 'OWNER' | 'MANAGER' | 'STAFF';

const STORE_PROFILE_KEY_PREFIX = 'stores:profile:';
const ADMIN_LOGIN_ALIAS = 'admin';
const ADMIN_LOGIN_PHONE = '13800000000';
const PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX = 'pulse:membership:admin:member:';

interface AccountIdentifiers {
  phone: string;
  email: string;
}

interface PhoneUserRecord {
  id: number;
  email: string;
  password: string;
  phone: string;
}

interface ProfileUserRecord {
  id: number;
  email: string;
  name: string | null;
  avatar: string | null;
  realName: string | null;
  idNumber: string | null;
  createdAt: Date;
  updatedAt: Date;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly accessControlService: AccessControlService,
    private readonly redisService: RedisService,
    private readonly configService: ConfigService,
    private readonly authSmsService: AuthSmsService,
  ) {}

  async sendRegisterCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendRegisterCodeResponseDto> {
    const normalizedPhone = this.normalizePhone(dto.phone);
    const expiresInSeconds = this.getRegisterCodeTtlSeconds();
    const existingUser = await this.findUserByPhone(normalizedPhone);

    if (existingUser) {
      throw new ConflictException('手机号已被注册');
    }

    const registerCode = this.generateNumericCode();
    const registerCodeKey = this.getRegisterCodeKey(normalizedPhone);
    await this.redisService.set(
      registerCodeKey,
      registerCode,
      expiresInSeconds,
    );

    try {
      await this.authSmsService.sendRegisterCode({
        phone: normalizedPhone,
        code: registerCode,
        expiresInSeconds,
      });
    } catch (error) {
      await this.redisService.del(registerCodeKey);
      throw error;
    }

    const response: SendRegisterCodeResponseDto = {
      message: '验证码已发送，请注意查收',
      expiresInSeconds,
    };

    if (this.isNonProductionEnv()) {
      return {
        ...response,
        code: registerCode,
      };
    }

    return response;
  }

  async register(dto: RegisterDto): Promise<AuthTokenResponseDto> {
    const normalizedPhone = this.normalizePhone(dto.phone);
    this.ensurePasswordConfirmation(
      dto.password,
      dto.confirmPassword,
      '两次输入的密码不一致',
    );

    const existing = await this.findUserByPhone(normalizedPhone);
    if (existing) {
      throw new ConflictException('手机号已被注册');
    }

    await this.ensureRegisterCodeValid(normalizedPhone, dto.code);

    const hashed = await bcrypt.hash(dto.password, 10);
    const accountIdentifiers = this.buildAccountIdentifiers(normalizedPhone);
    const user = await this.prisma.user.create({
      data: {
        email: accountIdentifiers.email,
        password: hashed,
        name: dto.name,
      },
      select: {
        id: true,
        email: true,
      },
    });

    await Promise.all([
      this.redisService.del(this.getRegisterCodeKey(normalizedPhone)),
      this.syncStaffMemberships(user.id, {
        phone: normalizedPhone,
        email: user.email,
      }),
    ]);

    return this.signToken(user.id, {
      phone: normalizedPhone,
      email: user.email,
    });
  }

  async login(dto: LoginDto): Promise<AuthTokenResponseDto> {
    const loginAccount = dto.phone ?? dto.account;

    if (!loginAccount) {
      throw new BadRequestException('登录账号不能为空');
    }

    const user = await this.findUserByLoginAccount(loginAccount);

    if (!user) {
      throw new UnauthorizedException('账号或密码错误');
    }

    const valid = await bcrypt.compare(dto.password, user.password);
    if (!valid) {
      throw new UnauthorizedException('账号或密码错误');
    }

    await this.syncStaffMemberships(user.id, {
      phone: user.phone,
      email: user.email,
    });
    await this.ensureUserNotBanned(user.id);

    return this.signToken(user.id, {
      phone: user.phone,
      email: user.email,
    });
  }

  async changePassword(
    user: AuthenticatedUser,
    dto: ChangePasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    this.ensurePasswordConfirmation(
      dto.newPassword,
      dto.confirmPassword,
      '两次输入的新密码不一致',
    );

    const currentUser = await this.prisma.user.findUnique({
      where: { id: user.id },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    if (!currentUser) {
      throw new UnauthorizedException('用户不存在');
    }

    const isCurrentPasswordValid = await bcrypt.compare(
      dto.currentPassword,
      currentUser.password,
    );
    if (!isCurrentPasswordValid) {
      throw new UnauthorizedException('当前密码错误');
    }

    const hashedPassword = await bcrypt.hash(dto.newPassword, 10);
    await this.prisma.user.update({
      where: { id: currentUser.id },
      data: { password: hashedPassword },
    });

    await this.bumpTokenVersion(currentUser.id);
    const token = await this.signToken(currentUser.id, {
      phone: user.phone,
      email: currentUser.email,
    });

    return {
      message: '密码修改成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }

  async forgotPassword(
    dto: ForgotPasswordDto,
  ): Promise<ForgotPasswordResponseDto> {
    const normalizedPhone = this.normalizePhone(dto.phone);
    const expiresInSeconds = this.getPasswordResetCodeTtlSeconds();
    const response: ForgotPasswordResponseDto = {
      message: '如手机号已注册，重置验证码短信已发送，请注意查收',
      expiresInSeconds,
    };
    const user = await this.findUserByPhone(normalizedPhone);

    if (!user) {
      return response;
    }

    const resetCode = this.generateNumericCode();
    const resetCodeKey = this.getPasswordResetCodeKey(normalizedPhone);
    await this.redisService.set(resetCodeKey, resetCode, expiresInSeconds);

    try {
      await this.authSmsService.sendPasswordResetCode({
        phone: normalizedPhone,
        code: resetCode,
        expiresInSeconds,
      });
    } catch (error) {
      await this.redisService.del(resetCodeKey);
      throw error;
    }

    if (this.isNonProductionEnv()) {
      return {
        ...response,
        resetCode,
      };
    }

    return response;
  }

  async resetPassword(
    dto: ResetPasswordDto,
  ): Promise<PasswordOperationResponseDto> {
    const normalizedPhone = this.normalizePhone(dto.phone);
    this.ensurePasswordConfirmation(
      dto.password,
      dto.confirmPassword,
      '两次输入的新密码不一致',
    );

    const resetCodeKey = this.getPasswordResetCodeKey(normalizedPhone);
    const cachedCode = await this.redisService.get(resetCodeKey);

    if (!cachedCode || cachedCode !== dto.code) {
      throw new UnauthorizedException('验证码无效或已过期');
    }

    const user = await this.findUserByPhone(normalizedPhone);

    if (!user) {
      await this.redisService.del(resetCodeKey);
      throw new UnauthorizedException('验证码无效或已过期');
    }

    const isSamePassword = await bcrypt.compare(dto.password, user.password);
    if (isSamePassword) {
      throw new BadRequestException('新密码不能与当前密码相同');
    }

    const hashedPassword = await bcrypt.hash(dto.password, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { password: hashedPassword },
    });

    await Promise.all([
      this.redisService.del(resetCodeKey),
      this.bumpTokenVersion(user.id),
    ]);

    const token = await this.signToken(user.id, {
      phone: normalizedPhone,
      email: user.email,
    });

    return {
      message: '密码重置成功，旧登录态已失效',
      access_token: token.access_token,
    };
  }

  async updateAvatar(
    user: AuthenticatedUser,
    dto: UpdateAvatarDto,
  ): Promise<ProfileResponseDto> {
    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        avatar: toNullableMediaText(dto.avatar),
      },
    });

    return this.getProfile(user);
  }

  async verifyRealName(
    user: AuthenticatedUser,
    dto: VerifyRealNameDto,
  ): Promise<ProfileResponseDto> {
    const existingVerifiedUser = await this.prisma.user.findFirst({
      where: {
        idNumber: dto.idNumber,
        id: { not: user.id },
      },
      select: { id: true },
    });

    if (existingVerifiedUser) {
      throw new ConflictException('该身份证号码已完成实名认证');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        realName: dto.realName,
        idNumber: dto.idNumber,
      },
    });

    return this.getProfile(user);
  }

  async getProfile(user: AuthenticatedUser): Promise<ProfileResponseDto> {
    const profileUser = await this.findProfileUserOrThrow(user.id);
    const memberships = await this.prisma.$queryRaw<
      Array<{
        staffId: number;
        storeId: number;
        role: MembershipRole;
        permissions: string[];
        isActive: boolean;
        storeName: string;
        address: string | null;
        storeCreatedAt: Date;
        storeUpdatedAt: Date;
      }>
    >`
      SELECT
        st.id AS "staffId",
        st.store_id AS "storeId",
        st.role,
        st.permissions,
        st.is_active AS "isActive",
        s.name AS "storeName",
        s.address,
        s.created_at AS "storeCreatedAt",
        s.updated_at AS "storeUpdatedAt"
      FROM staffs st
      INNER JOIN stores s ON s.id = st.store_id
      WHERE st.is_active = true
        AND st.status = 'ACTIVE'
        AND (
          st.user_id = ${user.id}
          OR st.email = ${user.email}
          OR st.phone = ${user.phone}
        )
      ORDER BY
        CASE st.role
          WHEN 'OWNER' THEN 0
          WHEN 'MANAGER' THEN 1
          ELSE 2
        END,
        st.id ASC
      LIMIT 1
    `;

    const [currentMembership] = memberships;
    const store = currentMembership
      ? buildStoreResponseDto(
          {
            id: currentMembership.storeId,
            name: currentMembership.storeName,
            address: currentMembership.address,
            createdAt: currentMembership.storeCreatedAt,
            updatedAt: currentMembership.storeUpdatedAt,
          },
          await this.readStoreProfileMetadata(currentMembership.storeId),
        )
      : null;

    return {
      user: {
        id: profileUser.id,
        phone: user.phone,
        email: profileUser.email,
        name: profileUser.name,
        avatar: toOptionalMediaText(profileUser.avatar) ?? '',
        verified: this.isVerifiedUser(profileUser),
        ...(profileUser.realName ? { realName: profileUser.realName } : {}),
        ...(profileUser.idNumber
          ? { idNumberMasked: this.maskIdNumber(profileUser.idNumber) }
          : {}),
        createdAt: profileUser.createdAt,
        updatedAt: profileUser.updatedAt,
      },
      store,
      currentMembership: currentMembership
        ? {
            staffId: currentMembership.staffId,
            storeId: currentMembership.storeId,
            role: currentMembership.role,
            permissions: this.accessControlService.getEffectivePermissions({
              role: currentMembership.role,
              permissions: currentMembership.permissions,
            }),
            isActive: currentMembership.isActive,
          }
        : null,
    };
  }

  private async findUserByLoginAccount(
    account: string,
  ): Promise<PhoneUserRecord | null> {
    const normalizedAccount = account.trim();
    const matchedPhone = this.extractPhoneFromLoginAccount(normalizedAccount);

    if (matchedPhone) {
      return this.findUserByPhone(matchedPhone);
    }

    if (normalizedAccount.toLowerCase() !== ADMIN_LOGIN_ALIAS) {
      return null;
    }

    return this.findUserByPhone(ADMIN_LOGIN_PHONE);
  }

  private async findUserByPhone(
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

    if (staff?.user) {
      return {
        ...staff.user,
        phone,
      };
    }

    const aliasEmail = this.buildAccountIdentifiers(phone).email;
    const aliasUser = await this.prisma.user.findUnique({
      where: { email: aliasEmail },
      select: {
        id: true,
        email: true,
        password: true,
      },
    });

    return aliasUser
      ? {
          ...aliasUser,
          phone,
        }
      : null;
  }

  private async ensureUserNotBanned(userId: number): Promise<void> {
    const relatedStoreIds = await this.findUserRelatedStoreIds(userId);
    if (relatedStoreIds.length === 0) {
      return;
    }

    const banReasons = await Promise.all(
      relatedStoreIds.map((storeId) =>
        this.redisService.get(this.getPulseAdminMemberBanReasonKey(storeId)),
      ),
    );
    const hasBannedStore = banReasons.some((reason) => Boolean(reason?.trim()));

    if (hasBannedStore) {
      throw new UnauthorizedException('账号已被封禁');
    }
  }

  private async findUserRelatedStoreIds(userId: number): Promise<number[]> {
    const stores = await this.prisma.store.findMany({
      where: {
        OR: [
          { ownerId: userId },
          {
            staffs: {
              some: {
                userId,
                isActive: true,
              },
            },
          },
        ],
      },
      select: {
        id: true,
      },
      orderBy: {
        id: 'asc',
      },
    });

    return stores.map((store) => store.id);
  }

  private getPulseAdminMemberBanReasonKey(storeId: number): string {
    return `${PULSE_ADMIN_MEMBER_BAN_REASON_KEY_PREFIX}${storeId}:ban-reason`;
  }

  private extractPhoneFromLoginAccount(account: string): string | null {
    return /^1[3-9]\d{9}$/.test(account) ? account : null;
  }

  private async findProfileUserOrThrow(
    userId: number,
  ): Promise<ProfileUserRecord> {
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

  private async ensureRegisterCodeValid(
    phone: string,
    code: string,
  ): Promise<void> {
    const cachedCode = await this.redisService.get(
      this.getRegisterCodeKey(phone),
    );
    if (!cachedCode || cachedCode !== code) {
      throw new UnauthorizedException('验证码无效或已过期');
    }
  }

  private async readStoreProfileMetadata(
    storeId: number,
  ): Promise<StoreProfileMetadata> {
    try {
      const raw = await this.redisService.get(this.getStoreProfileKey(storeId));
      if (!raw) {
        return normalizeStoreProfileMetadata(null);
      }

      return normalizeStoreProfileMetadata(JSON.parse(raw));
    } catch {
      return normalizeStoreProfileMetadata(null);
    }
  }

  private getStoreProfileKey(storeId: number): string {
    return `${STORE_PROFILE_KEY_PREFIX}${storeId}`;
  }

  private async syncStaffMemberships(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.staff.updateMany({
        where: {
          userId: null,
          OR: [{ email: identifiers.email }, { phone: identifiers.phone }],
        },
        data: {
          userId,
        },
      });

      const invitedStaffs = await tx.staff.findMany({
        where: {
          OR: [
            { userId },
            { email: identifiers.email },
            { phone: identifiers.phone },
          ],
          status: StaffStatus.INVITED,
          isActive: true,
        },
        select: {
          id: true,
          storeId: true,
        },
        orderBy: [{ storeId: 'asc' }, { id: 'asc' }],
      });

      if (invitedStaffs.length === 0) {
        return;
      }

      const activatableStaffIds = await this.resolveActivatableStaffIds(
        tx,
        invitedStaffs,
      );

      if (activatableStaffIds.length === 0) {
        return;
      }

      await tx.staff.updateMany({
        where: {
          id: {
            in: activatableStaffIds,
          },
        },
        data: {
          userId,
          status: StaffStatus.ACTIVE,
          isSeatActive: true,
          isActive: true,
        },
      });
    });
  }

  private async resolveActivatableStaffIds(
    tx: Prisma.TransactionClient,
    invitedStaffs: Array<{ id: number; storeId: number }>,
  ): Promise<number[]> {
    const [firstInvitedStaff] = invitedStaffs;
    if (!firstInvitedStaff) {
      return [];
    }

    const store = await tx.store.findUnique({
      where: { id: firstInvitedStaff.storeId },
      select: {
        id: true,
        maxAccountSeats: true,
      },
    });

    if (!store) {
      return [];
    }

    const activeSeatCount = await tx.staff.count({
      where: {
        storeId: store.id,
        status: StaffStatus.ACTIVE,
        isSeatActive: true,
        isActive: true,
      },
    });

    if (activeSeatCount >= store.maxAccountSeats) {
      return [];
    }

    return [firstInvitedStaff.id];
  }

  private async signToken(
    userId: number,
    identifiers: AccountIdentifiers,
  ): Promise<AuthTokenResponseDto> {
    const payload: JwtPayload = {
      sub: userId,
      phone: identifiers.phone,
      sessionVersion: await this.getTokenVersion(userId),
    };

    return {
      access_token: await this.jwtService.signAsync(payload),
    };
  }

  private buildAccountIdentifiers(phone: string): AccountIdentifiers {
    return {
      phone,
      email: `phone_${phone}@purelyprofit.local`,
    };
  }

  private normalizePhone(phone: string): string {
    return phone.trim();
  }

  private isVerifiedUser(user: ProfileUserRecord): boolean {
    return Boolean(user.realName && user.idNumber);
  }

  private maskIdNumber(idNumber: string): string {
    if (idNumber.length <= 8) {
      return idNumber;
    }

    return `${idNumber.slice(0, 6)}********${idNumber.slice(-4)}`;
  }

  private ensurePasswordConfirmation(
    password: string,
    confirmPassword: string | undefined,
    message: string,
  ): void {
    if (confirmPassword !== undefined && password !== confirmPassword) {
      throw new BadRequestException(message);
    }
  }

  private getPasswordResetCodeTtlSeconds(): number {
    return (
      this.configService.get<number>('auth.passwordResetCodeTtlSeconds') ??
      DEFAULT_PASSWORD_RESET_CODE_TTL_SECONDS
    );
  }

  private getRegisterCodeTtlSeconds(): number {
    return (
      this.configService.get<number>('auth.registerCodeTtlSeconds') ??
      DEFAULT_REGISTER_CODE_TTL_SECONDS
    );
  }

  private generateNumericCode(): string {
    const max = 10 ** AUTH_PASSWORD_RESET_CODE_LENGTH;
    return randomInt(0, max)
      .toString()
      .padStart(AUTH_PASSWORD_RESET_CODE_LENGTH, '0');
  }

  private getPasswordResetCodeKey(phone: string): string {
    return `${AUTH_PASSWORD_RESET_CODE_KEY_PREFIX}${phone}`;
  }

  private getRegisterCodeKey(phone: string): string {
    return `${AUTH_REGISTER_CODE_KEY_PREFIX}${phone}`;
  }

  private getTokenVersionKey(userId: number): string {
    return `${AUTH_TOKEN_VERSION_KEY_PREFIX}${userId}`;
  }

  private async getTokenVersion(userId: number): Promise<number> {
    const rawVersion = await this.redisService.get(
      this.getTokenVersionKey(userId),
    );
    const parsedVersion = Number.parseInt(rawVersion ?? '0', 10);
    return Number.isNaN(parsedVersion) ? 0 : parsedVersion;
  }

  private async bumpTokenVersion(userId: number): Promise<void> {
    const nextVersion = (await this.getTokenVersion(userId)) + 1;
    await this.redisService.set(
      this.getTokenVersionKey(userId),
      String(nextVersion),
    );
  }

  private isNonProductionEnv(): boolean {
    return this.configService.get<string>('nodeEnv') !== 'production';
  }
}
