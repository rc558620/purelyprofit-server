import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildClubWechatMemberPhone } from './auth.utils';
import { AuthAccountLookupService } from './auth-account-lookup.service';
import { AuthProfileService } from './auth-profile.service';
import { AuthBanGuardService } from './auth-ban-guard.service';
import { AuthPasswordService } from './auth-password.service';
import { AuthSessionService } from './auth-session.service';
import type {
  CreateUserFromWechatParams,
  WechatLoginAuthParams,
} from './auth-password.types';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';

/**
 * 微信小程序登录即注册服务（purely-club 专用）。
 *
 * 流程：
 * 1. 用 openid 查找已绑定的用户 → 有则刷新微信信息并登录
 *    - 若同时传入了 phone，额外将 wechat_phone 写入数据库（供手机号侧查找）
 * 2. 若 openid 未绑定任何账号，且传入了 phone：
 *    - 尝试用 phone 查找已有的手机号登录账号
 *    - 找到则将 wechat_openid 绑定到该账号（账号合并，手机号和微信共用同一账号）
 * 3. 若均无匹配，以 openid 创建新用户，phone 写入 wechat_phone 字段
 */
@Injectable()
export class AuthWechatLoginService {
  private readonly logger = new Logger(AuthWechatLoginService.name);

  constructor(
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authProfileService: AuthProfileService,
    private readonly authBanGuardService: AuthBanGuardService,
    private readonly authPasswordService: AuthPasswordService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  async wechatLogin(
    params: WechatLoginAuthParams,
  ): Promise<AuthTokenResponseDto> {
    const existingUser =
      await this.authAccountLookupService.findUserByWechatOpenid(params.openid);

    if (existingUser) {
      // 每次登录刷新微信头像、昵称和 unionid
      await this.authProfileService.updateWechatProfile(existingUser.id, {
        nickname: params.nickname,
        avatar: params.avatar,
        unionid: params.unionid,
      });

      // 若本次传入了手机号，写入 wechat_phone 前，先检查该手机号是否已被其他用户绑定
      if (params.phone) {
        await this.safeUpdateWechatPhone(existingUser.id, params.phone);
      }

      await this.authBanGuardService.ensureUserNotBanned(existingUser.id);

      return this.authSessionService.signToken(existingUser.id, {
        phone: existingUser.phone,
        email: existingUser.email,
        accountScope: 'purely_club',
      });
    }

    // openid 未绑定账号。若有真实手机号，先尝试找手机号账号并合并
    if (params.phone) {
      const phoneUser = await this.authAccountLookupService.findUserByPhone(
        params.phone,
        params.productScope,
      );

      if (phoneUser) {
        // 手机号账号已存在：将 openid 绑定到该账号（账号合并）
        // 使用 try/catch 处理 wechatOpenid 唯一约束冲突（P2002）
        try {
          await this.authProfileService.bindWechatToUser(phoneUser.id, {
            openid: params.openid,
            unionid: params.unionid,
            nickname: params.nickname,
            avatar: params.avatar,
            phone: params.phone,
          });
        } catch (error) {
          if (this.isUniqueConstraintError(error)) {
            throw new ConflictException(
              '该微信已绑定其他账号，无法自动合并，请联系客服',
            );
          }
          throw error;
        }

        await this.authBanGuardService.ensureUserNotBanned(phoneUser.id);

        return this.authSessionService.signToken(phoneUser.id, {
          phone: phoneUser.phone,
          email: phoneUser.email,
          accountScope: 'purely_club',
        });
      }
    }

    // 首次微信登录且无对应手机号账号：自动注册
    const createParams: CreateUserFromWechatParams = {
      openid: params.openid,
      unionid: params.unionid,
      nickname: params.nickname,
      avatar: params.avatar,
      phone: params.phone,
      productScope: params.productScope,
    };

    try {
      const newUser =
        await this.authPasswordService.createUserFromWechat(createParams);

      return this.authSessionService.signToken(newUser.id, {
        // 若拿到了真实手机号，使用真实手机号作为 JWT phone；否则用 openid 派生标识
        phone: params.phone ?? buildClubWechatMemberPhone(params.openid),
        email: newUser.email,
        accountScope: 'purely_club',
      });
    } catch (error) {
      // 并发首个微信登录时，可能被唯一索引 wechat_openid / email 抢占。
      // 这里回退成读取已创建账号并登录，避免正常重复点击直接 500。
      if (this.isUniqueConstraintError(error)) {
        const resolvedUser =
          await this.authAccountLookupService.findUserByWechatOpenid(
            params.openid,
          );
        if (resolvedUser) {
          await this.authBanGuardService.ensureUserNotBanned(resolvedUser.id);

          return this.authSessionService.signToken(resolvedUser.id, {
            phone: resolvedUser.phone,
            email: resolvedUser.email,
            accountScope: 'purely_club',
          });
        }
      }
      throw error;
    }
  }

  /**
   * 安全更新 wechatPhone：写入前先检查该手机号是否已被其他用户绑定，
   * 避免 A 用户的 wechatPhone 被覆盖为 B 用户手机号导致账号混淆。
   */
  private async safeUpdateWechatPhone(
    userId: number,
    phone: string,
  ): Promise<void> {
    const existingHolder =
      await this.authAccountLookupService.findUserByWechatPhone(phone);

    if (existingHolder && existingHolder.id !== userId) {
      // 手机号已被其他用户绑定，不覆盖，记录警告供后续人工客服或身份验证流程处理
      this.logger.warn(
        `wechatPhone 冲突：用户 ${userId} 尝试绑定手机号 ${phone}` +
          `，但该手机号已被用户 ${existingHolder.id}（email=${existingHolder.email}）绑定，已跳过`,
      );
      return;
    }

    await this.authProfileService.updateWechatPhone(userId, phone);
  }

  private isUniqueConstraintError(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }
}
