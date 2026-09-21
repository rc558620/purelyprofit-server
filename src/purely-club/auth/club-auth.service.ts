import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  NotImplementedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { AuthProductAuthService } from '../../shared/auth/auth-product-auth.service';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import {
  buildClubMemberDisplayName,
  isMainlandMobilePhone,
  normalizePhone,
} from '../../purely-profit/auth/auth.utils';
import { PrismaService, TX_TIMEOUT_LONG } from '../../prisma/prisma.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { ClubWechatAuthService } from './club-wechat-auth.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { BindPhoneByWechatCodeDto } from './dto/bind-phone-by-wechat-code.dto';
import { BindPhoneDto } from './dto/bind-phone.dto';
import { LoginByCodeDto } from './dto/login-by-code.dto';
import { RebindPhoneDto } from './dto/rebind-phone.dto';
import { SendLoginCodeResponseDto } from './dto/send-login-code-response.dto';
import { SendRegisterCodeDto } from './dto/send-register-code.dto';
import { WechatLoginDto } from './dto/wechat-login.dto';

const CLUB_WECHAT_PHONE_PREFIX = 'club_wechat:';
/** 换绑手机号冷静期（天）：同一账号在该期间内只能换绑一次 */
const CLUB_PHONE_REBIND_COOLDOWN_DAYS = 30;
const CLUB_PHONE_REBIND_COOLDOWN_MS =
  CLUB_PHONE_REBIND_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

@Injectable()
export class ClubAuthService {
  private readonly logger = new Logger(ClubAuthService.name);

  constructor(
    private readonly authProductAuthService: AuthProductAuthService,
    private readonly clubWechatAuthService: ClubWechatAuthService,
    private readonly prisma: PrismaService,
    private readonly authCodeVerifyService: AuthCodeVerifyService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authSessionService: AuthSessionService,
    private readonly storeAccessService: ClubStoreAccessService,
    private readonly configService: ConfigService,
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
   * 需要 JWT 鉴权。先校验短信验证码，再委托 bindVerifiedPhone 完成绑定。
   *
   * 验证码校验是后续所有合并动作的安全前提：bindVerifiedPhone 会按手机号
   * 查找已有账号并触发账号合并，若不校验验证码，攻击者填入他人手机号即可
   * 把自己的 openid 绑定到受害者账号上。
   */
  async bindPhone(
    userId: number,
    dto: BindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    // 1. 验证短信验证码（一次性消费）
    await this.authCodeVerifyService.ensureRegisterCodeValid(
      dto.phone,
      dto.code,
      'purely_club',
    );
    await this.authCodeVerifyService.clearRegisterCode(
      dto.phone,
      'purely_club',
    );

    // 2. 委托统一绑定实现
    return this.bindVerifiedPhone(userId, dto.phone);
  }

  /**
   * 绑定「已完成归属验证」的手机号。
   *
   * 短信验证码入口（bindPhone）与后续 getPhoneNumber 入口共用本方法：
   * 两者的差异仅在「如何证明手机号归属」，绑定与合并逻辑完全一致。
   *
   * - 若手机号已有账号 → 将当前微信 openid 合并到手机号账号：
   *   1. 迁移源用户（微信账号）的 Member 记录到目标用户（手机号账号）
   *   2. 迁移源用户的 Store ownership 到目标用户
   *   3. 将 openid 绑定到目标用户，清除源用户 openid
   * - 若手机号无账号 → 写入 wechatPhone，并把以 club_wechat:{openid}
   *   为占位 phone 的 Member / MarketingCustomer 迁移到真实手机号
   *
   * 合并操作包裹在数据库事务中，确保原子性。
   * 绑定成功后签发新 token，同时失效涉及的两端旧登录态。
   */
  async bindVerifiedPhone(
    userId: number,
    phone: string,
  ): Promise<AuthTokenResponseDto> {
    // 1. 查询当前用户
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        wechatOpenid: true,
        wechatUnionid: true,
        wechatNickname: true,
        wechatAvatar: true,
        wechatPhone: true,
      },
    });
    if (!currentUser) {
      throw new NotFoundException('用户不存在');
    }

    // 2. 检查手机号是否已有账号
    const existingPhoneUser =
      await this.authAccountLookupService.findUserByPhone(phone, 'purely_club');

    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      // 手机号已有其他账号：事务性合并
      // 合并前检查目标账号是否已绑定其他微信 openid，
      // 避免合并时覆盖目标账号的 openid 导致其微信号登录失效
      const targetUser = await this.prisma.user.findUnique({
        where: { id: existingPhoneUser.id },
        select: { wechatOpenid: true },
      });
      if (targetUser?.wechatOpenid) {
        throw new ConflictException(
          '该手机号已绑定其他微信账号，无法自动合并，请联系客服',
        );
      }
      return this.mergeWechatUserToPhoneUser(
        userId,
        existingPhoneUser.id,
        phone,
        currentUser,
      );
    }

    // 3. 手机号无其他账号：绑定到当前用户，并迁移占位手机号记录
    // 防御性检查：当前账号已绑定手机号时拒绝，避免 wechatPhone 被静默覆盖
    if (currentUser.wechatPhone?.trim()) {
      throw new ConflictException('当前账号已绑定手机号，无需重复绑定');
    }

    await this.prisma.$transaction(
      async (tx) => {
        await tx.user.update({
          where: { id: userId },
          data: { wechatPhone: phone },
        });

        if (currentUser.wechatOpenid) {
          await this.migrateWechatPlaceholderPhone(
            tx,
            userId,
            currentUser.wechatOpenid,
            phone,
          );
        }
      },
      { timeout: TX_TIMEOUT_LONG },
    );

    // 4. 签发新 token（phone 更新为真实手机号）
    return this.authSessionService.signToken(userId, {
      phone,
      email: currentUser.email,
      accountScope: 'purely_club',
    });
  }

  /**
   * 微信 getPhoneNumber 一键绑定手机号（批次 3 入口）。
   *
   * 与短信验证码绑定（`bindPhone`）的差异**只在「如何证明手机号归属」**：
   * - `bindPhone`：用户手输号码 + 短信验证码；
   * - 本方法：微信官方授权，服务端用 access_token 换取手机号，**无需短信**。
   *
   * 两者拿到手机号之后走完全相同的 `bindVerifiedPhone`，核心逻辑不重复实现。
   *
   * ⚠️ **不能复用 `login/wechat { phoneCode }`**：那条路对「已存在用户」走的是
   * existingUser 分支，只写 `wechat_phone` 而不迁移占位档案，且签发 token 用的是
   * **更新前**的 phone——会同时踩中批次 2 修好的两个坑（丢门店 + 商家端拿不到手机号）。
   *
   * 为什么这里**不校验短信验证码**：手机号归属由微信背书，服务端用 access_token
   * 才能兑换 code，且本接口要求 JWT 鉴权——攻击者即便拿到自己的 code，
   * 也只能绑定到自己的账号上，无法像短信路径那样「填入他人手机号触发合并」。
   */
  async bindPhoneByWechatCode(
    userId: number,
    dto: BindPhoneByWechatCodeDto,
  ): Promise<AuthTokenResponseDto> {
    // 该能力要求小程序已通过微信认证（个人主体不可用），默认关闭。
    // 认证通过后只需打开 auth.wechatPhoneBindEnabled，无需改代码。
    const enabled = this.configService.get<boolean>(
      'auth.wechatPhoneBindEnabled',
    );
    if (enabled !== true) {
      throw new NotImplementedException(
        '该入口暂未开放，请使用短信验证码绑定手机号',
      );
    }

    const phoneResult = await this.clubWechatAuthService.getPhoneNumber(
      dto.code,
    );
    const phone = normalizePhone(phoneResult.purePhoneNumber);

    // 海外号码 / 异常返回值不进入绑定流程，避免写出不合规的档案
    if (!isMainlandMobilePhone(phone)) {
      this.logger.warn(
        `bindPhoneByWechatCode 获取到非大陆手机号，user ${userId}`,
      );
      throw new ConflictException(
        '未能获取到有效的手机号，请改用短信验证码绑定',
      );
    }

    return this.bindVerifiedPhone(userId, phone);
  }

  /**
   * 换绑手机号：已绑定手机号的用户更换联系方式。
   *
   * 与「首次绑定」（bindPhone / bindVerifiedPhone）的三点关键差异：
   *
   * 1. **不触发账号合并**。新手机号若已属于其他账号，直接拒绝。绑定接口的合并
   *    语义是「找回账号」，换绑的语义是「更新联系方式」——在换绑里合并会吃掉
   *    另一个账号的档案与资产。
   * 2. **只校验新手机号**。用户换号后旧号已经收不到短信，要求校验旧号等于功能
   *    不可用。安全性由「已登录（openid + JWT）」与 30 天冷静期共同保证。
   * 3. **按 clubUserId 定位档案，绝不按 phone 更新**。旧手机号是真实号码，可能
   *    同时属于其他用户（历史数据、重复导入），按 phone 批量更新会串改他人档案。
   *    （首次绑定可以按 phone 更新，是因为占位值 `club_wechat:{openid}` 由 openid
   *    派生、在同一 appid 内天然唯一。）
   *
   * 换绑必须同步三处，漏任何一处都会立刻出问题：
   *
   * | 字段 | 漏同步的后果 |
   * |---|---|
   * | `users.wechat_phone` | `needPhoneBind` 判定与后续登录的 phone 来源不更新 |
   * | `Member.phone` | `findAccessibleStores` 正是按它匹配门店 → 用户**立刻失去全部门店访问权** |
   * | `MarketingCustomer.phone` | 商家端（purelyProfit）仍展示、检索旧号 |
   *
   * 另外 JWT 的 `phone` 参与 `Member` 匹配，因此成功后必须**重新签发 token**，
   * 否则旧 token 仍带旧号，上面的「失去门店访问权」照样发生。
   */
  async rebindPhone(
    userId: number,
    dto: RebindPhoneDto,
  ): Promise<AuthTokenResponseDto> {
    // 1. 当前用户
    const currentUser = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        wechatPhone: true,
        phoneRebindAt: true,
      },
    });
    if (!currentUser) {
      throw new NotFoundException('用户不存在');
    }

    const previousPhone = currentUser.wechatPhone?.trim() ?? '';
    if (!previousPhone) {
      // 未绑定过手机号：应走 bindPhone（可能触发账号合并），而不是换绑
      throw new ConflictException('当前账号尚未绑定手机号，请先绑定手机号');
    }
    if (previousPhone === dto.phone) {
      throw new ConflictException('新手机号与当前手机号相同');
    }

    // 2. 新手机号不能已属于其他账号 —— 拒绝，绝不合并（见方法注释第 1 点）
    const existingPhoneUser =
      await this.authAccountLookupService.findUserByPhone(
        dto.phone,
        'purely_club',
      );
    if (existingPhoneUser && existingPhoneUser.id !== userId) {
      throw new ConflictException('该手机号已绑定其他账号，请更换手机号');
    }

    // 3. 冷静期
    this.assertRebindAllowed(currentUser.phoneRebindAt);

    // 4. 校验新手机号归属（一次性消费）。
    //
    // 刻意排在「同号 / 他人占用 / 冷静期」这些**确定性校验之后**：这些失败都与
    // 验证码无关，先消费验证码会让用户白白损失一次短信（必须重新获取才能再试）。
    await this.authCodeVerifyService.ensureRegisterCodeValid(
      dto.phone,
      dto.code,
      'purely_club',
    );
    await this.authCodeVerifyService.clearRegisterCode(
      dto.phone,
      'purely_club',
    );

    // 5. 事务内同步三处。
    //
    // 顺序刻意**先认领 + 校验，再写 users**：任何一步失败都会整事务回滚，
    // 不会出现「users 已换号、顾客档案没跟上」的半截状态。
    await this.prisma.$transaction(
      async (tx) => {
        const storeIds = await this.prepareRebindTargets(
          tx,
          userId,
          previousPhone,
          dto.phone,
        );

        await tx.user.update({
          where: { id: userId },
          data: { wechatPhone: dto.phone, phoneRebindAt: new Date() },
        });

        await this.syncPhoneAcrossProfiles(
          tx,
          userId,
          storeIds,
          previousPhone,
          dto.phone,
        );
      },
      { timeout: TX_TIMEOUT_LONG },
    );

    // 6. 清「可访问门店」缓存：其内容是按旧手机号匹配 Member 得到的
    await this.storeAccessService.invalidateAccessibleStoresCache(userId);

    // 7. 重新签发 token（见方法注释末段）
    return this.authSessionService.signToken(userId, {
      phone: dto.phone,
      email: currentUser.email,
      accountScope: 'purely_club',
    });
  }

  /**
   * 换绑时把该用户在**所有门店**的档案由旧号改为新号。
   *
   * 两处定位方式不同，原因在于两张表的可用键不同：
   *
   * | 表 | 定位方式 | 为什么 |
   * |---|---|---|
   * | `MarketingCustomer` | `clubUserId` | 有该列，且有 `(storeId, clubUserId)` 唯一约束 |
   * | `Member` | `storeId IN (该用户有档案的门店)` + `phone = 旧号` | **既无 `clubUserId`，`customerId` 在现存数据里也全为 null**（该列是「可选、兼容历史数据」），无法靠关联定位 |
   *
   * 两处都**不跨门店按 `phone` 更新**：旧号是真实号码，可能同时属于其他用户，
   * 无门店限定的 `phone` 更新会串改他人档案。（首次绑定可以按 `phone` 更新，
   * 是因为占位值 `club_wechat:{openid}` 由 openid 派生、天然全局唯一。）
   *
   * 两处都**不过滤 `deletedAt`**：软删除的档案仍然参与 `findAccessibleStores` 的
   * `members.some({ phone })` 匹配（该查询没有过滤 deletedAt）。残留一条旧号档案，
   * 就足以让后续绑定了该旧号的**另一个用户**看到本用户的门店与会员数据。
   *
   * `storeIds` 由 `prepareRebindTargets` 在写入前算好（认领孤儿 + 冲突校验），
   * 这里只负责把变更落盘，两步分开是为了让失败停在任何写入之前。
   */
  private async syncPhoneAcrossProfiles(
    tx: Prisma.TransactionClient,
    userId: number,
    storeIds: number[],
    previousPhone: string,
    nextPhone: string,
  ): Promise<void> {
    const customerResult = await tx.marketingCustomer.updateMany({
      where: { clubUserId: userId },
      data: { phone: nextPhone },
    });

    // 不依赖 customerId：现存 Member 的 customer_id 全为 null，
    // 按 customerId 更新会命中 0 条 → Member.phone 留在旧号 →
    // 新 token 用新号匹配不到门店，用户当场失去全部门店访问权。
    const memberResult =
      storeIds.length > 0
        ? await tx.member.updateMany({
            where: { storeId: { in: storeIds }, phone: previousPhone },
            data: { phone: nextPhone },
          })
        : { count: 0 };

    // 同步自动生成的展示名：由旧号派生的「纯利会员XXXX」对新号已无意义，
    // 商家端会一直显示旧号后 4 位。仅当名字确实是自动生成的那个才改，
    // 避免覆盖商家在 purelyProfit 手动改过的名字。
    // 必须放在 phone 更新之后——where 用的是新号。
    const previousAutoName = buildClubMemberDisplayName(previousPhone);
    const nextAutoName = buildClubMemberDisplayName(nextPhone);
    const renameWhere = { phone: nextPhone, name: previousAutoName };

    const renamedCustomerResult = await tx.marketingCustomer.updateMany({
      where: { clubUserId: userId, ...renameWhere },
      data: { name: nextAutoName },
    });
    const renamedMemberResult =
      storeIds.length > 0
        ? await tx.member.updateMany({
            where: { storeId: { in: storeIds }, ...renameWhere },
            data: { name: nextAutoName },
          })
        : { count: 0 };

    this.logger.log(
      `rebindPhone 同步档案：${previousPhone} → ${nextPhone}，user ${userId}，` +
        `门店 ${storeIds.length} 家，` +
        `MarketingCustomer phone ${customerResult.count} 条 / name ${renamedCustomerResult.count} 条，` +
        `Member phone ${memberResult.count} 条 / name ${renamedMemberResult.count} 条`,
    );
  }

  /**
   * 写入前准备：认领孤儿档案 → 算出门店范围 → 校验门店维度手机号唯一性。
   *
   * 两件事都必须在 `tx.user.update` 之前完成：
   * 1. **认领孤儿档案**（`claimUnboundCustomers`）：历史「邀请码入店」路径创建的
   *    顾客档案没带 `clubUserId`，不认领就整店漏同步；
   * 2. **门店维度手机号唯一性**：商家端改手机号走 `ensureUniquePhone`
   *    （storeId + phone 唯一），换绑是批量 update，必须补同等校验，否则同门店
   *    会留下两条同号顾客档案，`marketing-consumption-link` 按 `(storeId, phone)`
   *    findFirst 关联时可能把消费挂到错误档案上。
   */
  private async prepareRebindTargets(
    tx: Prisma.TransactionClient,
    userId: number,
    previousPhone: string,
    nextPhone: string,
  ): Promise<number[]> {
    await this.claimUnboundCustomers(tx, userId, previousPhone);

    const customers = await tx.marketingCustomer.findMany({
      where: { clubUserId: userId },
      select: { storeId: true },
    });
    const storeIds = [...new Set(customers.map((item) => item.storeId))];

    if (storeIds.length > 0) {
      const conflictingCustomer = await tx.marketingCustomer.findFirst({
        where: {
          storeId: { in: storeIds },
          phone: nextPhone,
          // 排除本人名下（含 null）的档案，只拦截真正属于他人的记录
          clubUserId: { not: userId },
          deletedAt: null,
        },
        select: { id: true, storeId: true },
      });
      if (conflictingCustomer) {
        throw new ConflictException(
          '该手机号已被门店内的其他顾客档案占用，请联系商家处理后再换绑',
        );
      }
    }

    return storeIds;
  }

  /**
   * 认领「同手机号、但未绑定 club 用户」的历史顾客档案。
   *
   * 背景：早期「邀请码 / 扫码入店」路径 (`ClubStoreAccessService.joinStoreByInviteCode`)
   * 建档时没有写入 `clubUserId`（现已修复，但存量数据仍是空的）。这些档案只靠
   * `phone` 与本用户关联，换绑后 `previousPhone` 一改就彻底失联——它们在营销侧永远
   * 停在旧号，用户下次到店消费还会分裂出第二条顾客档案（余额/积分看起来「清零」）。
   *
   * 认领条件收紧到三条同时成立，避免把他人档案挂到本用户名下：
   * 1. `phone = previousPhone`（本用户换号前正在使用的号码，含微信占位值）；
   * 2. `clubUserId IS NULL`（尚未归属任何 club 用户，他人已绑定的不动）；
   * 3. 该门店本人尚未有已绑定档案（排除 `(storeId, clubUserId)` 唯一约束冲突，
   *    也避免同一门店出现两条本人档案）。
   *
   * 这与 `ClubScanOrderingMarketingCustomerService.resolveActiveCustomer` 的
   * legacy claim 语义一致，只是覆盖面从「扫码点单时」提前到「换绑时」。
   */
  private async claimUnboundCustomers(
    tx: Prisma.TransactionClient,
    userId: number,
    previousPhone: string,
  ): Promise<number> {
    const boundCustomers = await tx.marketingCustomer.findMany({
      where: { clubUserId: userId },
      select: { storeId: true },
    });
    const boundStoreIds = [
      ...new Set(boundCustomers.map((item) => item.storeId)),
    ];

    const unboundCustomers = await tx.marketingCustomer.findMany({
      where: {
        phone: previousPhone,
        clubUserId: null,
        deletedAt: null,
        ...(boundStoreIds.length > 0
          ? { storeId: { notIn: boundStoreIds } }
          : {}),
      },
      select: { id: true, storeId: true },
    });

    if (unboundCustomers.length === 0) {
      return 0;
    }

    // 同一门店可能存在多条同号孤儿记录（历史重复导入）：只认领一条，
    // 其余保持不动，交给人工/迁移脚本处理，避免连锁改写。
    const claimedStoreIds = new Set<number>();
    let claimedCount = 0;

    for (const customer of unboundCustomers) {
      if (claimedStoreIds.has(customer.storeId)) continue;

      // 二次确认：并发写可能刚好把这行绑到别的用户名下，updateMany 会静默命中 0 条
      const result = await tx.marketingCustomer.updateMany({
        where: { id: customer.id, clubUserId: null },
        data: { clubUserId: userId },
      });
      if (result.count > 0) {
        claimedStoreIds.add(customer.storeId);
        claimedCount += 1;
      }
    }

    if (claimedCount > 0) {
      this.logger.log(
        `rebindPhone 认领孤儿顾客档案：user ${userId}，${claimedCount} 条，` +
          `门店 [${[...claimedStoreIds].join(', ')}]`,
      );
    }

    return claimedCount;
  }

  /**
   * 换绑冷静期校验。
   *
   * 换绑只校验新号（旧号可能已作废），因此需要一道频率闸门：账号若被他人短暂
   * 拿到（手机借人、微信仍处于登录态），对方改号后商家端所有触达都会打到对方
   * 手机上。正常用户换号频率极低，30 天限制对真实场景无感。
   */
  private assertRebindAllowed(rebindAt: Date | null): void {
    if (!rebindAt) return;

    const elapsed = Date.now() - rebindAt.getTime();
    if (elapsed >= CLUB_PHONE_REBIND_COOLDOWN_MS) return;

    const remainingDays = Math.ceil(
      (CLUB_PHONE_REBIND_COOLDOWN_MS - elapsed) / MS_PER_DAY,
    );
    throw new ConflictException(
      `手机号换绑过于频繁，请 ${remainingDays} 天后再试`,
    );
  }

  /**
   * 将微信占位手机号（club_wechat:{openid}）迁移为真实手机号。
   *
   * 背景：微信无手机号用户以 club_wechat:{openid} 作为 Member / MarketingCustomer
   * 的 phone 占位值（见 ClubStoreAccessService.resolveMemberPhone 与
   * AuthAccountLookupService.findUserByWechatOpenid 的 phone 映射）。
   * 绑定手机号后 JWT 的 phone 立即切换为真实手机号，若不迁移这些记录：
   * - 用户查不到自己的门店（getAccessibleStores 按 Member.phone 匹配）
   * - 商家端（purelyProfit）拿不到该顾客的真实手机号
   *
   * 占位值由 openid 派生、在同一 appid 内全局唯一，因此批量更新不会误伤其他用户。
   */
  private async migrateWechatPlaceholderPhone(
    tx: Prisma.TransactionClient,
    userId: number,
    openid: string,
    phone: string,
  ): Promise<void> {
    const placeholderPhone = `${CLUB_WECHAT_PHONE_PREFIX}${openid}`;

    // members 表仅有 (storeId, phone) 普通索引、无唯一约束，故直接批量更新；
    // 此处刻意不做「去重删除」，避免误删可能带纯利豆余额的会员记录。
    const memberResult = await tx.member.updateMany({
      where: { phone: placeholderPhone },
      data: { phone },
    });

    // marketing_customers 存在 uq_marketing_customers_store_club_user
    // 部分唯一索引（club_user_id IS NOT NULL），补充 clubUserId 时必须
    // 排除该门店已绑定同一用户的记录，否则触发唯一约束冲突。
    const alreadyBoundStoreIds = (
      await tx.marketingCustomer.findMany({
        where: { phone: placeholderPhone, clubUserId: userId },
        select: { storeId: true },
      })
    ).map((item) => item.storeId);

    // 未绑定该用户的门店：同步 phone 并补上 clubUserId，
    // 使后续按 user.id 精确匹配，避免同门店多个无手机号顾客时的回退歧义。
    const customerResult = await tx.marketingCustomer.updateMany({
      where: {
        phone: placeholderPhone,
        ...(alreadyBoundStoreIds.length > 0 && {
          storeId: { notIn: alreadyBoundStoreIds },
        }),
      },
      data: { phone, clubUserId: userId },
    });

    // 已绑定该用户的门店：仅同步 phone，保留原有绑定关系
    if (alreadyBoundStoreIds.length > 0) {
      await tx.marketingCustomer.updateMany({
        where: {
          phone: placeholderPhone,
          storeId: { in: alreadyBoundStoreIds },
        },
        data: { phone },
      });
    }

    // 兜底：仅带 club_user_id、phone 为 null 的营销顾客档案。
    // 扫码点餐链路的 resolveActiveCustomer 在用户尚未绑手机号时会把 phone 落成 null，
    // 这类记录匹配不到上面的占位值，若不补齐，商家端仍无法按手机号找到该顾客。
    // 已由上面处理过的门店跳过，避免同店出现两条同手机号档案。
    const nullPhoneBoundResult = await tx.marketingCustomer.updateMany({
      where: {
        clubUserId: userId,
        phone: null,
        ...(alreadyBoundStoreIds.length > 0 && {
          storeId: { notIn: alreadyBoundStoreIds },
        }),
      },
      data: { phone },
    });

    // 同步自动生成的展示名。占位手机号派生出的名字（如「纯利会员HR5Y」）取自 openid
    // 后 4 位，对商家没有意义；绑定真实手机号后应重新按手机号后 4 位生成。
    // 仅当名字确实是自动生成的那个才更新，避免覆盖商家在 purelyProfit 手动改过的名字。
    // 必须放在上面 phone 更新之后——where 用的是迁移后的新手机号。
    const previousAutoName = buildClubMemberDisplayName(placeholderPhone);
    const nextAutoName = buildClubMemberDisplayName(phone);

    const renamedMemberResult = await tx.member.updateMany({
      where: { phone, name: previousAutoName },
      data: { name: nextAutoName },
    });
    const renamedCustomerResult = await tx.marketingCustomer.updateMany({
      where: { phone, name: previousAutoName },
      data: { name: nextAutoName },
    });

    this.logger.log(
      `bindPhone 迁移占位手机号：${placeholderPhone} → ${phone}，` +
        `Member ${memberResult.count} 条，MarketingCustomer ${customerResult.count} 条，` +
        `仅 clubUserId 绑定补 phone ${nullPhoneBoundResult.count} 条，` +
        `展示名同步 Member ${renamedMemberResult.count} 条 / ` +
        `MarketingCustomer ${renamedCustomerResult.count} 条`,
    );
  }

  /**
   * 定位源用户在各门店的会员档案（Member + MarketingCustomer）。
   *
   * **不能假设 `Member.phone` 还是占位值 `club_wechat:{openid}`**：用户可能先绑过
   * 一个手机号（那时 `migrateWechatPlaceholderPhone` 已把 Member.phone 迁成真实号码），
   * 之后才绑到另一个已有账号上触发合并。只按占位值查找会**一条都找不到**，
   * 结果是 openid 合过去了、会员档案与资产全留在源账号上。
   *
   * Member 既没有 `clubUserId`，`customerId` 在现存数据里又全为 null，
   * 因此只能以 `MarketingCustomer.clubUserId` 为**权威桥梁**先拿到门店范围，
   * 再在该范围内按「可能的手机号」定位；同时保留按占位值全局定位
   * （占位值由 openid 派生、在同一 appid 内天然唯一）。
   *
   * @param sourcePhone 源用户当前已绑定的手机号，可能是真实号码而非占位值
   */
  private async resolveSourceMembership(
    tx: Prisma.TransactionClient,
    sourceUserId: number,
    sourceWechatOpenid: string,
    sourcePhone: string | null,
  ): Promise<{
    members: Array<{ id: number; storeId: number; beanBalance: number }>;
    customers: Array<{
      id: number;
      storeId: number;
      balance: number;
      points: number;
      totalSpent: number;
      visitCount: number;
    }>;
  }> {
    const placeholderPhone = `${CLUB_WECHAT_PHONE_PREFIX}${sourceWechatOpenid}`;
    const candidatePhones = Array.from(
      new Set(
        [placeholderPhone, sourcePhone].filter(
          (value): value is string => !!value && value.trim().length > 0,
        ),
      ),
    );

    const customers = await tx.marketingCustomer.findMany({
      where: { clubUserId: sourceUserId },
      select: {
        id: true,
        storeId: true,
        balance: true,
        points: true,
        totalSpent: true,
        visitCount: true,
      },
    });
    const storeIds = customers.map((item) => item.storeId);

    // 占位值定位：覆盖「有 Member 但尚未建立 clubUserId 关联」的历史形态
    const membersByPlaceholder = await tx.member.findMany({
      where: { phone: placeholderPhone },
      select: { id: true, storeId: true, beanBalance: true },
    });

    // 门店范围 + 候选手机号：覆盖「已迁到真实号码」的形态
    const membersInScopedStores =
      storeIds.length > 0
        ? await tx.member.findMany({
            where: {
              storeId: { in: storeIds },
              phone: { in: candidatePhones },
            },
            select: { id: true, storeId: true, beanBalance: true },
          })
        : [];

    // 正向关联（customerId 将来会被填充），有则用其精确定位
    const membersByCustomerLink =
      customers.length > 0
        ? await tx.member.findMany({
            where: { customerId: { in: customers.map((item) => item.id) } },
            select: { id: true, storeId: true, beanBalance: true },
          })
        : [];

    // 三条路径可能命中同一条记录，按 id 去重
    const membersById = new Map<
      number,
      { id: number; storeId: number; beanBalance: number }
    >();
    for (const member of [
      ...membersByPlaceholder,
      ...membersInScopedStores,
      ...membersByCustomerLink,
    ]) {
      membersById.set(member.id, member);
    }

    return { members: [...membersById.values()], customers };
  }

  /**
   * 事务性合并：将微信用户的 openid、Member 记录和 Store ownership 迁移到手机号账号
   *
   * 合并步骤（全部在同一个数据库事务中）：
   * 1. 迁移源用户（微信账号）在各门店的 Member / MarketingCustomer 档案到目标用户
   *    - 同一门店下目标用户已有档案 → 先把源档案的资产（纯利豆 / 储值 / 积分）
   *      并入目标档案，再**软删除**源档案并清空 phone
   *    - 同一门店下目标用户无档案 → 直接将源档案的 phone / clubUserId 改到目标用户
   * 2. 迁移源用户的 Store ownership（ownerId）到目标用户
   * 3. 将 openid 从源用户移到目标用户，清除源用户的微信相关字段
   *
   * 事务失败时整体回滚，不会出现中间状态。
   *
   * ⚠️ 定位源档案时**不要假设 `phone` 还是占位值**：用户可能先绑过一个手机号（那时
   * `migrateWechatPlaceholderPhone` 已把它迁成真实号码），之后才绑到另一个已有账号上
   * 触发合并。只认占位值会一条都找不到 —— openid 合过去了，会员档案、储值余额、积分、
   * 纯利豆全留在源账号上，用户在新账号里看不到自己的资产（见 03 文档第 6 节 P0）。
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
      /** 源用户当前已绑定的手机号（可能已是真实号码，而非占位值） */
      wechatPhone: string | null;
    },
  ): Promise<AuthTokenResponseDto> {
    if (!sourceUser.wechatOpenid) {
      throw new ConflictException(
        '当前微信账号缺少 openid，无法完成合并，请联系客服',
      );
    }

    // 取局部常量：闭包内 TS 不会保留对 sourceUser 字段的收窄
    const sourceOpenid = sourceUser.wechatOpenid;

    try {
      await this.prisma.$transaction(
        async (tx) => {
          // 1. 迁移会员档案（Member + MarketingCustomer）
          //    定位方式见 resolveSourceMembership —— 不再假设 phone 还是占位值
          const { members: sourceMembers, customers: sourceCustomers } =
            await this.resolveSourceMembership(
              tx,
              sourceUserId,
              sourceOpenid,
              sourceUser.wechatPhone,
            );

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

            const sourceMemberIdsToUpdate: number[] = [];

            for (const sourceMember of sourceMembers) {
              const targetMember = targetMemberByStoreId.get(
                sourceMember.storeId,
              );

              if (!targetMember) {
                sourceMemberIdsToUpdate.push(sourceMember.id);
                this.logger.log(
                  `bindPhone 合并 Member：门店 ${sourceMember.storeId} 将源 Member ${sourceMember.id} 的 phone 更新为 ${phone}`,
                );
                continue;
              }

              // 目标门店已有 Member：先把纯利豆结转过去，再软删除源 Member。
              // 不硬删：纯利豆 / 积分 / 充值流水是必填外键且没有级联，硬删会直接抛错；
              // 同时必须清空 phone —— findAccessibleStores 的 members.some({ phone })
              // 不过滤 deletedAt，留着旧号会让将来绑了这个号的人看到本用户的门店。
              if (sourceMember.beanBalance > 0) {
                await tx.member.update({
                  where: { id: targetMember.id },
                  data: {
                    beanBalance: { increment: sourceMember.beanBalance },
                  },
                });
              }
              await tx.member.update({
                where: { id: sourceMember.id },
                data: { phone: null, deletedAt: new Date() },
              });
              this.logger.log(
                `bindPhone 合并 Member：门店 ${sourceMember.storeId} 目标已有 Member ${targetMember.id}，` +
                  `结转纯利豆 ${sourceMember.beanBalance} 后软删除源 Member ${sourceMember.id}`,
              );
            }

            if (sourceMemberIdsToUpdate.length > 0) {
              await tx.member.updateMany({
                where: { id: { in: sourceMemberIdsToUpdate } },
                data: { phone },
              });
            }
          }

          // 1.2 迁移营销顾客档案：储值余额 / 积分 / 消费记录都挂在它上面。
          //     此前合并完全没搬这类档案，用户在新账号里会凭空"没有资产"。
          if (sourceCustomers.length > 0) {
            const targetCustomers = await tx.marketingCustomer.findMany({
              where: {
                storeId: { in: sourceCustomers.map((c) => c.storeId) },
                clubUserId: targetUserId,
              },
              select: { id: true, storeId: true },
            });
            const targetCustomerByStoreId = new Map(
              targetCustomers.map((c) => [c.storeId, c]),
            );

            const customerIdsToRebind: number[] = [];

            for (const sourceCustomer of sourceCustomers) {
              const targetCustomer = targetCustomerByStoreId.get(
                sourceCustomer.storeId,
              );

              if (!targetCustomer) {
                customerIdsToRebind.push(sourceCustomer.id);
                continue;
              }

              // 目标门店已有顾客档案：把资产并入后软删除源档案
              //（同样不硬删：消费 / 积分 / 充值流水是必填外键且无级联）
              await tx.marketingCustomer.update({
                where: { id: targetCustomer.id },
                data: {
                  balance: { increment: sourceCustomer.balance },
                  points: { increment: sourceCustomer.points },
                  totalSpent: { increment: sourceCustomer.totalSpent },
                  visitCount: { increment: sourceCustomer.visitCount },
                },
              });
              await tx.marketingCustomer.update({
                where: { id: sourceCustomer.id },
                data: { clubUserId: null, phone: null, deletedAt: new Date() },
              });
              this.logger.log(
                `bindPhone 合并 MarketingCustomer：门店 ${sourceCustomer.storeId} 目标已有档案 ${targetCustomer.id}，` +
                  `并入余额 ${sourceCustomer.balance} / 积分 ${sourceCustomer.points} 后软删除源档案 ${sourceCustomer.id}`,
              );
            }

            // 目标在该门店没有档案：直接改绑 clubUserId 并同步为新手机号
            if (customerIdsToRebind.length > 0) {
              await tx.marketingCustomer.updateMany({
                where: { id: { in: customerIdsToRebind } },
                data: { clubUserId: targetUserId, phone },
              });
            }
          }

          // 2. 迁移 Store ownership（源用户拥有的门店转移到目标用户）
          const ownedStores = await tx.store.findMany({
            where: { ownerId: sourceUserId, deletedAt: null },
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
        },
        { timeout: TX_TIMEOUT_LONG },
      );
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
