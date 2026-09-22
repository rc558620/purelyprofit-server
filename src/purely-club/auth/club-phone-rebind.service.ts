import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { AuthCodeVerifyService } from '../../purely-profit/auth/auth-code-verify.service';
import { AuthAccountLookupService } from '../../purely-profit/auth/auth-account-lookup.service';
import { AuthSessionService } from '../../purely-profit/auth/auth-session.service';
import { buildClubMemberDisplayName } from '../../purely-profit/auth/auth.utils';
import { PrismaService, TX_TIMEOUT_LONG } from '../../prisma/prisma.service';
import { ClubStoreAccessService } from '../stores/club-store-access.service';
import { AuthTokenResponseDto } from './dto/auth-token-response.dto';
import { RebindPhoneDto } from './dto/rebind-phone.dto';

/** 换绑手机号冷静期（天）：同一账号在该期间内只能换绑一次 */
const CLUB_PHONE_REBIND_COOLDOWN_DAYS = 30;
const CLUB_PHONE_REBIND_COOLDOWN_MS =
  CLUB_PHONE_REBIND_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * 手机号换绑：已绑定手机号的用户更换联系方式。
 *
 * 与「首次绑定」（ClubPhoneBindService）的三点关键差异：
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
 */
@Injectable()
export class ClubPhoneRebindService {
  private readonly logger = new Logger(ClubPhoneRebindService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly authCodeVerifyService: AuthCodeVerifyService,
    private readonly authAccountLookupService: AuthAccountLookupService,
    private readonly authSessionService: AuthSessionService,
    private readonly storeAccessService: ClubStoreAccessService,
  ) {}

  /**
   * 换绑手机号。
   *
   * 必须同步三处，漏任何一处都会立刻出问题：
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

    // 2. 新手机号不能已属于其他账号 —— 拒绝，绝不合并（见类注释第 1 点）
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
}
