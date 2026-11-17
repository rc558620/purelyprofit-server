import { CLUB_AUTH_ERROR_CODE, clubAuthError } from './club-auth.errors';
import { ConflictException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { buildClubMemberDisplayName } from '../../purely-profit/auth/auth.utils';

/**
 * 一次换绑涉及的账号与新旧手机号。
 *
 * 档案同步的各个方法都要同时用到这三项，收敛成单一入参对象，避免每个方法都摆 4~5 个
 * 位置参数——参数一多，调用点顺序写反时类型系统也拦不住。
 */
export interface ClubPhoneRebindChange {
  /** club 账号 id（users.id），档案同步的主锚点 */
  userId: number;
  /** 换绑前手机号（可能是微信占位值 club_wechat:{openid}） */
  previousPhone: string;
  /** 换绑后手机号 */
  nextPhone: string;
}

/**
 * 换绑手机号的**档案同步**子服务：Member / MarketingCustomer 的 phone 与自动展示名。
 *
 * 与 `ClubPhoneRebindService` 的分工：
 * - 主服务负责校验（同号 / 他人占用 / 跨产品线 / 冷静期 / 验证码）、事务编排与
 *   登录态轮换；
 * - 本服务只负责事务内的「认领孤儿档案 → 算门店范围 → 门店维度唯一性校验 →
 *   批量落盘」，**不自行开启事务**，也不在事务外做任何写。
 *
 * 定位口径（为什么主锚点是 clubUserId、而不是按 phone 批量改）见
 * `syncPhoneAcrossProfiles` 的注释。
 */
@Injectable()
export class ClubPhoneRebindProfilesService {
  private readonly logger = new Logger(ClubPhoneRebindProfilesService.name);

  /**
   * 写入前准备：认领孤儿档案 → 算出门店范围 → 校验门店维度手机号唯一性。
   *
   * 三件事都必须在 `tx.user.update` 之前完成：
   * 1. **认领孤儿档案**（`claimUnboundCustomers`）：历史「邀请码入店」路径创建的
   *    顾客档案没带 `clubUserId`，不认领就整店漏同步；
   * 2. **算出门店范围**：取三处并集（见方法内的说明）。只按营销顾客档案算门店，
   *    会漏掉「有 Member 但没有 MarketingCustomer」的历史门店；
   * 3. **门店维度手机号唯一性**：商家端改手机号走 `ensureUniquePhone`
   *    （storeId + phone 唯一），换绑是批量 update，必须补同等校验，否则同门店
   *    会留下两条同号档案，`marketing-consumption-link` 按 `(storeId, phone)`
   *    findFirst 关联时可能把消费挂到错误档案上。
   *
   * @returns 需要同步的会员档案所在门店 id（去重）
   */
  async prepareRebindTargets(
    tx: Prisma.TransactionClient,
    change: ClubPhoneRebindChange,
  ): Promise<number[]> {
    const { userId, previousPhone, nextPhone } = change;

    // 认领步骤直接回传「认领后本人在该门店已有绑定顾客档案」的门店集合，
    // 不再按 `clubUserId` 重查一次同一张表：改动前同一条事务里
    // `claimUnboundCustomers` 与这里各扫一遍 `marketing_customers`，
    // 而两次扫描只差「本事务刚认领的那几行」，重复扫描纯属浪费行锁持有时间。
    const customerStoreIds = await this.claimUnboundCustomers(
      tx,
      userId,
      previousPhone,
    );

    // 门店范围取三处并集：
    // 1. 已绑定的营销顾客档案（含本事务刚认领的，见上）；
    // 2. 已绑定 clubUserId 的会员档案 —— 覆盖「有 Member 但没有 MarketingCustomer」
    //    的历史门店，只按 1 算会整店漏同步；
    // 3. 仍靠旧号关联的无主会员档案 —— 覆盖从未写过 clubUserId 的存量数据。
    //    与 `claimUnboundCustomers` 同前提：此刻持有旧号的 club 用户就是本人
    //    （`users.wechat_phone` 唯一，不存在第二个 club 账号握着同一个号）。
    const [boundMembers, unboundMembers] = await Promise.all([
      tx.member.findMany({
        where: { clubUserId: userId },
        select: { storeId: true },
      }),
      tx.member.findMany({
        where: { phone: previousPhone, clubUserId: null },
        select: { storeId: true },
      }),
    ]);

    const storeIds = [
      ...new Set([
        ...customerStoreIds,
        ...boundMembers.map((item) => item.storeId),
        ...unboundMembers.map((item) => item.storeId),
      ]),
    ];

    if (storeIds.length === 0) return storeIds;

    const conflictingCustomer = await tx.marketingCustomer.findFirst({
      where: {
        storeId: { in: storeIds },
        phone: nextPhone,
        // 仅放过本人名下的档案。clubUserId 为 null 的历史/手工建档在 SQL 中
        // 不满足 `<> userId`（NULL 参与比较结果为 unknown），必须显式纳入拦截，
        // 否则会误改他人档案
        OR: [{ clubUserId: null }, { clubUserId: { not: userId } }],
        deletedAt: null,
      },
      select: { id: true, storeId: true },
    });
    if (conflictingCustomer) {
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.RULE_PHONE_OCCUPIED_BY_OTHER_CUSTOMER,
          '该手机号已被门店内的其他顾客档案占用，请联系商家处理后再换绑',
        ),
      );
    }

    // 会员档案同样要查一遍：只校验顾客档案的话，同店可能留下两条同号**会员**，
    // 而 `getSnapshotByStoreAndPhone`、`joinStoreByInviteCode` 的封禁判定都按
    // `(storeId, phone)` findFirst 命中，会把别人的会员档当成自己的。
    const conflictingMember = await tx.member.findFirst({
      where: {
        storeId: { in: storeIds },
        phone: nextPhone,
        // 同上：clubUserId 为 null 的会员档案同样视为他人占号
        OR: [{ clubUserId: null }, { clubUserId: { not: userId } }],
        deletedAt: null,
      },
      select: { id: true, storeId: true },
    });
    if (conflictingMember) {
      throw new ConflictException(
        clubAuthError(
          CLUB_AUTH_ERROR_CODE.RULE_PHONE_OCCUPIED_BY_OTHER_MEMBER,
          '该手机号已被门店内的其他会员档案占用，请联系商家处理后再换绑',
        ),
      );
    }

    return storeIds;
  }

  /**
   * 换绑时把该用户在**所有门店**的档案由旧号改为新号。
   *
   * 两条定位路径，按「档案是否已经带上本人身份锚点」区分：
   *
   * | 路径 | 定位方式 | 覆盖的档案 |
   * |---|---|---|
   * | 主锚点 | `clubUserId = userId` | 回填迁移写过的存量档案、以及所有有该列的档案 |
   * | 兜底 | `(storeId, phone = 旧号, clubUserId IS NULL)` 且**同店唯一命中** | 从未写过 `clubUserId` 的历史档案 |
   *
   * 为什么不继续用「门店 + 旧号」作为唯一口径（`members.club_user_id` 出现前的写法）：
   *
   * 1. **漏更新**：`clubUserId` 已绑定但 `phone` 不再是旧号的档案（商家端改过会员
   *    手机号、或同号多条里 phone 被历史改写过）命中 0 条 —— 若该档案
   *    `clubUserId` 为 null，`findAccessibleStores` 的第 2 层就失配，用户当场失去
   *    该门店；
   * 2. **串改他人**：同门店存在另一条 `phone = 旧号` 的档案（他人档案或商家手工
   *    建档）会被一并改成新号。商家端自己改手机号时特意要求「同店唯一命中」才改
   *    （见 `marketing-customers.service.ts`），换绑没有理由比它更宽松。
   *
   * 主锚点那一步**不带门店限定**：`clubUserId = userId` 本身就锁定了身份，
   * 且能顺带覆盖「有 Member 但没有 MarketingCustomer」的历史门店
   * （`storeIds` 之外的门店也会被同步）。
   *
   * 两处都**不过滤 `deletedAt`**：软删除的档案仍然参与 `findAccessibleStores` 的
   * `members.some(...)` 匹配（该查询没有过滤 deletedAt）。残留一条旧号档案，
   * 就足以让后续绑定了该旧号的**另一个用户**看到本用户的门店与会员数据。
   *
   * `storeIds` 由 `prepareRebindTargets` 在写入前算好（认领孤儿 + 冲突校验），
   * 这里只负责把变更落盘，两步分开是为了让失败停在任何写入之前。
   */
  async syncPhoneAcrossProfiles(
    tx: Prisma.TransactionClient,
    change: ClubPhoneRebindChange,
    storeIds: number[],
  ): Promise<void> {
    const { userId, previousPhone, nextPhone } = change;

    const customerResult = await tx.marketingCustomer.updateMany({
      where: { clubUserId: userId },
      data: { phone: nextPhone },
    });

    // 主锚点：与 buildMemberIdentityWhere 第 1 层同源，不依赖 customerId
    // （现存 Member 的 customer_id 全为 null，按它定位会命中 0 条）。
    const memberResult = await tx.member.updateMany({
      where: { clubUserId: userId },
      data: { phone: nextPhone },
    });

    // 兜底：仍无 clubUserId 的存量档案，只在「同店唯一命中」时改。
    const unboundMemberIds = await this.resolveUnboundMemberIds(
      tx,
      storeIds,
      previousPhone,
    );
    const unboundMemberResult =
      unboundMemberIds.length > 0
        ? await tx.member.updateMany({
            where: { id: { in: unboundMemberIds } },
            data: { phone: nextPhone },
          })
        : { count: 0 };

    // 同步自动生成的展示名：由旧号派生的「纯利会员XXXX」对新号已无意义，
    // 商家端会一直显示旧号后 4 位。仅当名字确实是自动生成的那个才改，
    // 避免覆盖商家在 purelyProfit 手动改过的名字。
    // 必须放在 phone 更新之后——where 用的是新号。
    const previousAutoName = buildClubMemberDisplayName(previousPhone);
    const nextAutoName = buildClubMemberDisplayName(nextPhone);

    const renamedCustomerResult = await tx.marketingCustomer.updateMany({
      where: { clubUserId: userId, phone: nextPhone, name: previousAutoName },
      data: { name: nextAutoName },
    });
    const renamedMemberResult = await tx.member.updateMany({
      where: {
        phone: nextPhone,
        name: previousAutoName,
        OR: [
          { clubUserId: userId },
          ...(unboundMemberIds.length > 0
            ? [{ id: { in: unboundMemberIds } }]
            : []),
        ],
      },
      data: { name: nextAutoName },
    });

    this.logger.log(
      `rebindPhone 同步档案：${previousPhone} → ${nextPhone}，user ${userId}，` +
        `门店 ${storeIds.length} 家，` +
        `MarketingCustomer phone ${customerResult.count} 条 / name ${renamedCustomerResult.count} 条，` +
        `Member phone ${memberResult.count} 条（clubUserId）+ ${unboundMemberResult.count} 条（无主兜底）/ ` +
        `name ${renamedMemberResult.count} 条`,
    );
  }

  /**
   * 挑出可以安全改号的**无主**会员档案（`clubUserId IS NULL`）。
   *
   * 「无主」档案只靠 `phone` 与本人关联，换绑后 `previousPhone` 一改就彻底失联，
   * 因此必须在本轮一起改到新号。判定收紧到三条同时成立：
   *
   * 1. 门店在 `storeIds` 内（本人确实与该门店有关系）；
   * 2. `phone = 旧号` 且 `clubUserId IS NULL`（已归属任何 club 用户的档案走主锚点
   *    那条路径，不在本方法的射程内，避免重复改写）；
   * 3. **该门店内同号无主档案只有一条** —— 同店同号多条时无法判定哪条属于本人，
   *    `updateMany` 会把它们一并改写，放大影响面。这与商家端改手机号
   *    （`marketing-customers.service.ts`）的口径一致：宁可留下一条旧号档案交给
   *    人工处理，也不能改错别人的档案。
   *
   * 不按 `deletedAt` 过滤，理由见 `syncPhoneAcrossProfiles` 的注释。
   *
   * @returns 可以安全改号的会员档案 id（空数组表示没有需要兜底的档案）
   */
  private async resolveUnboundMemberIds(
    tx: Prisma.TransactionClient,
    storeIds: number[],
    previousPhone: string,
  ): Promise<number[]> {
    if (storeIds.length === 0) return [];

    const candidates = await tx.member.findMany({
      where: {
        storeId: { in: storeIds },
        phone: previousPhone,
        clubUserId: null,
      },
      select: { id: true, storeId: true },
    });

    const countByStoreId = new Map<number, number>();
    for (const candidate of candidates) {
      countByStoreId.set(
        candidate.storeId,
        (countByStoreId.get(candidate.storeId) ?? 0) + 1,
      );
    }

    return candidates
      .filter((candidate) => countByStoreId.get(candidate.storeId) === 1)
      .map((candidate) => candidate.id);
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
   *
   * @returns 认领后「本人已有绑定顾客档案」的门店 id（原绑定 + 本事务认领）
   */
  private async claimUnboundCustomers(
    tx: Prisma.TransactionClient,
    userId: number,
    previousPhone: string,
  ): Promise<number[]> {
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
      return boundStoreIds;
    }

    // 同一门店可能存在多条同号孤儿记录（历史重复导入）：只认领一条，
    // 其余保持不动，交给人工/迁移脚本处理，避免连锁改写。
    const firstIdPerStore = new Map<number, number>();
    for (const customer of unboundCustomers) {
      if (!firstIdPerStore.has(customer.storeId)) {
        firstIdPerStore.set(customer.storeId, customer.id);
      }
    }

    // 一条 updateMany 覆盖全部门店：原实现在事务内按门店逐条 updateMany，
    // 事务长度与门店数线性相关，换绑这种多表写链路会把行锁一直持到事务结束。
    // 仍保留 `clubUserId: null` 前置条件：并发被他人抢先认领的行静默跳过，
    // 语义与逐条二次确认完全一致。
    const result = await tx.marketingCustomer.updateMany({
      where: { id: { in: [...firstIdPerStore.values()] }, clubUserId: null },
      data: { clubUserId: userId },
    });
    const claimedCount = result.count;

    if (claimedCount > 0) {
      this.logger.log(
        `rebindPhone 认领孤儿顾客档案：user ${userId}，${claimedCount} 条，` +
          `候选门店 [${[...firstIdPerStore.keys()].join(', ')}]`,
      );
    }

    // 回传「认领后本人在该门店已有绑定顾客档案」的门店集合（原绑定 + 本事务认领），
    // 供调用方直接复用，省掉同事务内对 marketing_customers 的第二次同条件扫描。
    return [...new Set([...boundStoreIds, ...firstIdPerStore.keys()])];
  }
}
