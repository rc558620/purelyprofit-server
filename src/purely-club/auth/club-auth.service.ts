import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeService } from '../../purely-profit/auth/auth-code.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { PrismaService } from '../../prisma/prisma.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

const CLUB_WECHAT_PHONE_PREFIX = 'club_wechat:';

@Injectable()
export class ClubAuthService {
  private readonly logger = new Logger(ClubAuthService.name);

  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
    private readonly clubWechatAuthService: ClubWechatAuthService,
    private readonly prisma: PrismaService,
    private readonly authCodeService: AuthCodeService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authSessionService: AuthSessionService,
  ) {}

  /**
   * 发送登录即注册验证码
   * 无论手机号是否已注册都发送，不暴露注册状态
   */
  sendLoginCode(dto: SendRegisterCodeDto): Promise<SendLoginCodeResponseDto> {
    return this.authProductAuthService.sendClubLoginOrRegisterCode({
      phone: dto.phone,
      captchaToken: dto.captchaToken,
    });
  }

  /**
   * 发送绑定手机号验证码
   * 无论手机号是否已注册都发送，不暴露注册状态
   * 需要 JWT 鉴权，仅允许已登录用户调用
   */
  sendBindPhoneCode(
    dto: SendRegisterCodeDto,
  ): Promise<SendLoginCodeResponseDto> {
    return this.authProductAuthService.sendBindPhoneCode({
      phone: dto.phone,
      captchaToken: dto.captchaToken,
    });
  }

  /**
   * 手机号验证码登录即注册
   * 账号不存在时自动创建，省去单独注册步骤
   */
  loginByCode(dto: LoginByCodeDto): Promise<AuthTokenResponseDto> {
    return this.authProductAuthService.loginByCodeOrRegister(
      dto,
      'purely_club',
    );
  }

  /**
   * 微信小程序登录即注册
   *
   * 流程：
   * 1. code2session：wx.login() 的 code → openid / session_key
   * 2. （可选）getPhoneNumber：phoneCode → 真实手机号（用于账号合并）
   * 3. wechatLogin：openid + 手机号 → 已有账号则登录并合并；无则自动注册
   * 4. 检查是否需要绑定手机号：若账号尚无真实手机号，返回 needPhoneBind=true
   */
  async wechatLogin(dto: WechatLoginDto): Promise<AuthTokenResponseDto> {
    const wechatResult = await this.clubWechatAuthService.code2session(
      dto.code,
    );

    // 若前端传入了手机号授权 code，解密获取真实手机号
    let phone: string | undefined;
    if (dto.phoneCode) {
      const phoneResult = await this.clubWechatAuthService.getPhoneNumber(
        dto.phoneCode,
      );
      phone = phoneResult.purePhoneNumber;
    }

    const result = await this.authProductAuthService.wechatLogin(
      {
        openid: wechatResult.openid,
        unionid: wechatResult.unionid,
        nickname: dto.nickname,
        avatar: dto.avatar,
        phone,
      },
      'purely_club',
    );

    // 登录完成后检查用户是否需要绑定手机号
    const needPhoneBind = result.userId
      ? await this.checkNeedPhoneBind(result.userId)
      : undefined;

    return {
      ...result,
      ...(needPhoneBind !== undefined && { needPhoneBind }),
    };
  }

  /**
   * 绑定手机号（微信登录后补绑手机号）
   *
   * 需要 JWT 鉴权。验证短信验证码后：
   * - 若手机号已有账号 → 将当前微信 openid 合并到手机号账号：
   *   1. 迁移源用户（微信账号）的 Member 记录到目标用户（手机号账号）
   *   2. 迁移源用户的 Store ownership 到目标用户
   *   3. 将 openid 绑定到目标用户，清除源用户 openid
   * - 若手机号无账号 → 给当前用户写入 wechatPhone
   *
   * 合并操作包裹在数据库事务中，确保原子性。
   * 绑定成功后签发新 token，同时失效涉及的两端旧登录态。
   */
  async bindPhone(
    userId: number,
    dto: BindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    // 1. 验证短信验证码
    await this.authCodeService.ensureRegisterCodeValid(
      dto.phone,
      dto.code,
      'purely_club',
    );
    await this.authCodeService.clearRegisterCode(dto.phone, 'purely_club');

    // 2. 查询当前用户
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        wechatOpenid: true,
        wechatUnionid: true,
        wechatNickname: true,
        wechatAvatar: true,
      },
    });
    if (!currentUser) {
      throw new NotFoundException('用户不存在');
    }

    // 3. 检查手机号是否已有账号
    const existingPhoneUser =
      await this.authAccountLookupService.findUserByPhone(
        dto.phone,
        'purely_club',
      );

    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      // 手机号已有其他账号：事务性合并
      return this.mergeWechatUserToPhoneUser(
        userId,
        existingPhoneUser.id,
        dto.phone,
        currentUser,
      );
    }

    // 4. 手机号无其他账号：直接绑定到当前用户
    await this.prisma.user.update({
      where: { id: userId },
      data: { wechatPhone: dto.phone },
    });

    // 5. 签发新 token（phone 更新为真实手机号）
    return this.authSessionService.signToken(userId, {
      phone: dto.phone,
      email: currentUser.email,
      accountScope: 'purely_club',
    });
  }

  /**
   * 事务性合并：将微信用户的 openid、Member 记录和 Store ownership 迁移到手机号账号
   *
   * 合并步骤（全部在同一个数据库事务中）：
   * 1. 迁移源用户（微信账号）在各门店的 Member 记录到目标用户（手机号账号）
   *    - 同一门店下目标用户已有 Member → 保留目标用户的 Member，删除源用户的
   *    - 同一门店下目标用户无 Member → 将源用户 Member 的 phone 更新为目标用户的手机号
   * 2. 迁移源用户的 Store ownership（ownerId）到目标用户
   * 3. 将 openid 从源用户移到目标用户，清除源用户的微信相关字段
   *
   * 事务失败时整体回滚，不会出现中间状态。
   */
  private async mergeWechatUserToPhoneUser(
    sourceUserId: number,
    targetUserId: number,
    phone: string,
    sourceUser: {
      wechatOpenid: string | null;
      wechatUnionid: string | null;
      wechatNickname: string | null;
      wechatAvatar: string | null;
    },
  ): Promise<AuthTokenResponseDto> {
    if (!sourceUser.wechatOpenid) {
      throw new ConflictException(
        '当前微信账号缺少 openid，无法完成合并，请联系客服',
      );
    }

    const sourceWechatPhone = `${CLUB_WECHAT_PHONE_PREFIX}${sourceUser.wechatOpenid}`;

    try {
      await this.prisma.$transaction(async (tx) => {
        // 1. 迁移 Member 记录
        // 查找源用户在各门店的 Member 记录（phone 为 club_wechat:openid 格式）
        const sourceMembers = await tx.member.findMany({
          where: { phone: sourceWechatPhone },
          select: { id: true, storeId: true },
        });

        if (sourceMembers.length > 0) {
          // 批量查询目标用户在这些门店是否已有 Member 记录，避免逐个 findUnique
          const storeIds = sourceMembers.map((m) => m.storeId);
          const targetMembers = await tx.member.findMany({
            where: { storeId: { in: storeIds }, phone },
            select: { id: true, storeId: true },
          });
          const targetMemberByStoreId = new Map(
            targetMembers.map((m) => [m.storeId, m]),
          );

          // 按是否已有目标 member 分组处理
          const sourceMemberIdsToDelete: number[] = [];
          const sourceMemberIdsToUpdate: number[] = [];

          for (const sourceMember of sourceMembers) {
            const targetMember = targetMemberByStoreId.get(
              sourceMember.storeId,
            );
            if (targetMember) {
              sourceMemberIdsToDelete.push(sourceMember.id);
              this.logger.log(
                `bindPhone 合并 Member：门店 ${sourceMember.storeId} 目标用户已有 Member ${targetMember.id}，删除源 Member ${sourceMember.id}`,
              );
            } else {
              sourceMemberIdsToUpdate.push(sourceMember.id);
              this.logger.log(
                `bindPhone 合并 Member：门店 ${sourceMember.storeId} 将源 Member ${sourceMember.id} 的 phone 从 ${sourceWechatPhone} 更新为 ${phone}`,
              );
            }
          }

          // 批量删除 + 批量更新，替代逐条操作
          if (sourceMemberIdsToDelete.length > 0) {
            await tx.member.deleteMany({
              where: { id: { in: sourceMemberIdsToDelete } },
            });
          }
          if (sourceMemberIdsToUpdate.length > 0) {
            await tx.member.updateMany({
              where: { id: { in: sourceMemberIdsToUpdate } },
              data: { phone },
            });
          }
        }

        // 2. 迁移 Store ownership（源用户拥有的门店转移到目标用户）
        const ownedStores = await tx.store.findMany({
          where: { ownerId: sourceUserId },
          select: { id: true },
        });

        if (ownedStores.length > 0) {
          await tx.store.updateMany({
            where: { ownerId: sourceUserId },
            data: { ownerId: targetUserId },
          });
          this.logger.log(
            `bindPhone 合并 Store ownership：将 ${ownedStores.length} 个门店从用户 ${sourceUserId} 转移到用户 ${targetUserId}`,
          );
        }

        // 3. 先清除源用户的微信相关字段（必须在绑定到目标用户之前执行），
        //    否则 wechat_openid 的唯一约束会导致写入目标用户时冲突
        await tx.user.update({
          where: { id: sourceUserId },
          data: {
            wechatOpenid: null,
            wechatUnionid: null,
            wechatNickname: null,
            wechatAvatar: null,
            wechatPhone: null,
          },
        });

        // 4. 将 openid 绑定到目标用户，同时写入 wechatPhone
        await tx.user.update({
          where: { id: targetUserId },
          data: {
            wechatOpenid: sourceUser.wechatOpenid,
            ...(sourceUser.wechatUnionid != null && {
              wechatUnionid: sourceUser.wechatUnionid,
            }),
            ...(sourceUser.wechatNickname != null && {
              wechatNickname: sourceUser.wechatNickname,
            }),
            ...(sourceUser.wechatAvatar != null && {
              wechatAvatar: sourceUser.wechatAvatar,
            }),
            wechatPhone: phone,
          },
        });
      });
    } catch (error) {
      this.logger.error(
        `bindPhone 合并事务失败：sourceUserId=${sourceUserId}, targetUserId=${targetUserId}`,
        error instanceof Error ? error.stack : String(error),
      );
      throw new ConflictException('账号合并失败，请重试或联系客服');
    }

    // 失效两端的旧登录态，确保合并后旧 token 立即无效
    await Promise.all([
      this.authSessionService.bumpTokenVersion(sourceUserId),
      this.authSessionService.bumpTokenVersion(targetUserId),
    ]);

    // 签发新 token（以手机号账号身份登录）
    const targetUser = await this.prisma.user.findUnique({
      where: { id: targetUserId },
      select: { email: true },
    });

    return this.authSessionService.signToken(targetUserId, {
      phone,
      email: targetUser?.email ?? '',
      accountScope: 'purely_club',
    });
  }

  /**
   * 查询用户是否需要绑定手机号
   * 若查询失败则返回 undefined（不阻断主流程）
   */
  private async checkNeedPhoneBind(
    userId: number,
  ): Promise<boolean | undefined> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { wechatPhone: true },
      });
      if (!user) return undefined;

      // wechatPhone 为空说明尚未绑定真实手机号
      return !user.wechatPhone?.trim();
    } catch (error: unknown) {
      this.logger.warn(
        `检查用户 ${userId} 手机绑定状态失败: ${error instanceof Error ? error.message : String(error)}`,
      );
      return undefined;
    }
  }
}
