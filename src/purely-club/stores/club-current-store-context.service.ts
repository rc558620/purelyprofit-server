import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../redis/redis.service';
import {
  CLUB_LEGACY_ERROR_CODE,
  clubBusinessError,
} from '../shared/club-business-errors';
import { CLUB_STORES_ERROR_CODE, clubStoresError } from './club-stores.errors';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubStoreAccessService } from './club-store-access.service';
import {
  ClubCurrentContextCache,
  type ClubCurrentContextSnapshot,
} from './club-current-context.cache';
import type {
  ClubAccessibleStoreRecord,
  ClubCurrentContext,
} from './club-stores.types';

const CLUB_SELECTED_STORE_KEY_PREFIX = 'club:selected-store:';
const CLUB_STORE_NOT_FOUND_MESSAGE = '当前账号暂无可访问门店';
const CLUB_STORE_FORBIDDEN_MESSAGE = '无权访问该门店，或门店不存在';

/**
 * 「无可访问门店」业务错误码。
 *
 * C 端靠它把「该账号确实没有门店」与其它 404 区分开：命中时要清掉本地缓存的
 * 门店并跳门店选择页，而不是原地报错把用户卡死。仅按 HTTP 404 无法区分，
 * 按文案匹配又会在改文案时静默失效，因此用稳定业务码做跨仓库契约。
 *
 * 该字段由全局异常过滤器透传（见 `AllExceptionsFilter` 的 code 处理）。
 * 修改必须与 purelyClub 的 `NO_ACCESSIBLE_STORE_BIZ_CODE` 同步。
 *
 * 语义边界：这个码表达的是「当前无法确定用户要进哪家店，请去选店页」，
 * 涵盖两种情形 —— 账号确实没有可访问门店、以及有多家门店但尚未显式选择。
 * 后者复用同一码是刻意的兼容决策：前端既有的兜底动作（清缓存 + 跳选店页）
 * 对它同样正确，因此无需改动 purelyClub 即可消除资金的隐式归属错配。
 * 若将来要按更细的业务码分支，必须前后端同步新增，不能单方面改码值。
 */
export const CLUB_NO_ACCESSIBLE_STORE_CODE =
  CLUB_LEGACY_ERROR_CODE.NO_ACCESSIBLE_STORE;
/** 选中门店缓存的 TTL（秒），30 天后自然过期避免内存泄漏 */
const CLUB_SELECTED_STORE_TTL_SECONDS = 30 * 24 * 60 * 60;

@Injectable()
export class ClubCurrentStoreContextService {
  constructor(
    private readonly redisService: RedisService,
    private readonly clubStoreAccessService: ClubStoreAccessService,
    private readonly clubCurrentContextCache: ClubCurrentContextCache,
  ) {}

  async resolveCurrentContext(
    user: AuthenticatedUser,
  ): Promise<ClubCurrentContext> {
    const store = await this.getCurrentStore(user);
    return {
      user,
      store,
    };
  }

  async requireCurrentContext(
    user: AuthenticatedUser,
    requestedStoreId?: number,
  ): Promise<ClubCurrentContext> {
    const currentContext = await this.resolveCurrentContext(user);
    if (
      requestedStoreId != null &&
      currentContext.store.id !== requestedStoreId
    ) {
      throw new BadRequestException(
        clubStoresError(
          CLUB_STORES_ERROR_CODE.RULE_STORE_CHANGED,
          '当前门店已切换，请刷新页面后重试',
        ),
      );
    }

    return currentContext;
  }

  async getCurrentStore(
    user: AuthenticatedUser,
  ): Promise<ClubAccessibleStoreRecord> {
    const memoized = this.clubCurrentContextCache.get(user.id);
    if (memoized) {
      return this.resolveStoreFromSnapshot(
        user.id,
        memoized.stores,
        memoized.selectedStoreId,
      );
    }

    const snapshot = await this.loadAccessSnapshot(user);
    const store = await this.resolveStoreFromSnapshot(
      user.id,
      snapshot.stores,
      snapshot.selectedStoreId,
    );
    // 只缓存「成功解析出当前门店」的结果：把「需要选店」的失败态缓存住，
    // 会让用户刚选完店仍被同一业务码拦截。
    this.clubCurrentContextCache.set(user.id, {
      stores: snapshot.stores,
      selectedStoreId: store.id,
    });
    return store;
  }

  /**
   * 从快照解析当前门店；无可访问门店或多门店未显式选店时抛业务错误。
   *
   * 多门店且没有有效选店时不能隐式落到第一个门店：充值、储值、下单、
   * 查余额全部以 currentStore 为准，静默回落会把钱记到用户没选的那家店。
   * 复用同一业务码，让前端既有的「清缓存 + 跳门店选择页」兜底生效。
   */
  private async resolveStoreFromSnapshot(
    userId: number,
    stores: ClubAccessibleStoreRecord[],
    selectedStoreId: number | null,
  ): Promise<ClubAccessibleStoreRecord> {
    if (stores.length === 0) {
      return this.throwStoreSelectionRequired(userId);
    }

    const currentStoreId = await this.resolveCurrentStoreIdFromValue(
      userId,
      stores,
      selectedStoreId,
    );
    if (currentStoreId === null) {
      return this.throwStoreSelectionRequired(userId);
    }

    return stores.find((store) => store.id === currentStoreId) ?? stores[0];
  }

  /**
   * 一次 MGET 读出「可访问门店」与「选中门店」两个 key。
   *
   * 原实现每次请求固定两次独立 GET；合并后固定一次。门店列表未命中时
   * 直接回源并写缓存，不再重复读一次 Redis；选中门店已在本轮取回，
   * 同样不再二次往返。
   */
  private async loadAccessSnapshot(
    user: AuthenticatedUser,
  ): Promise<ClubCurrentContextSnapshot> {
    const [storesRaw, selectedStoreRaw] = await this.redisService.mget([
      this.clubStoreAccessService.buildAccessibleStoresCacheKey(user.id),
      this.buildSelectedStoreKey(user.id),
    ]);
    const cachedStores =
      this.clubStoreAccessService.parseAccessibleStores(storesRaw);
    const selectedStoreId = this.parseSelectedStoreId(selectedStoreRaw);

    if (cachedStores) {
      return { stores: cachedStores, selectedStoreId };
    }

    return {
      stores: await this.clubStoreAccessService.refreshAccessibleStores(user),
      selectedStoreId,
    };
  }

  /** 抛「需要选店」业务码，并清掉可能已失效的选店缓存。 */
  private async throwStoreSelectionRequired(userId: number): Promise<never> {
    await this.clearSelectedStoreId(userId);
    throw new NotFoundException(
      clubBusinessError(
        CLUB_NO_ACCESSIBLE_STORE_CODE,
        CLUB_STORE_NOT_FOUND_MESSAGE,
      ),
    );
  }

  async switchCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<ClubAccessibleStoreRecord> {
    const store = await this.clubStoreAccessService.findAccessibleStoreById(
      user,
      storeId,
    );
    if (!store) {
      throw new ForbiddenException(
        clubStoresError(
          CLUB_STORES_ERROR_CODE.AUTH_STORE_FORBIDDEN,
          CLUB_STORE_FORBIDDEN_MESSAGE,
        ),
      );
    }

    await this.persistSelectedStoreId(user.id, store.id);
    return store;
  }

  /**
   * 入店路径的「确保当前门店是目标门店」：已经是该门店时直接返回，不走
   * 可访问性查询 + Redis SET。
   *
   * 语义安全性：选中值只可能由 {@link switchCurrentStore} /
   * {@link resolveCurrentStoreIdFromValue} 在通过可访问性校验后写入，
   * 因此「已是选中门店」本身代表此前校验通过；若期间失去该门店访问权，
   * {@link getCurrentStore} 会用最新门店列表把失效选中值过滤掉，不会因此放行。
   *
   * 与 `switchCurrentStore` 的差异仅在于省掉一次 `members.some` OR 查询与一次 SET——
   * 扫码进桌是最高频链路，多门店用户反复扫同一家店时这次查询纯属重复。
   */
  async ensureCurrentStore(
    user: AuthenticatedUser,
    storeId: number,
  ): Promise<void> {
    const memoized = this.clubCurrentContextCache.get(user.id);
    if (memoized?.selectedStoreId === storeId) {
      return;
    }

    if ((await this.readSelectedStoreId(user.id)) === storeId) {
      return;
    }

    await this.switchCurrentStore(user, storeId);
  }

  /**
   * 解析当前门店 ID；返回 null 表示「需要用户显式选店」。
   *
   * 只在单门店时自动选中。多门店且没有有效选店时若回落 `stores[0]`，
   * 资金会记到用户没选的门店；更不能把回落值写进 Redis —— 否则
   * `GET /club/stores` 这个选店页必经接口会抢先「替用户选好」，
   * 让 getCurrentStore 的拦截形同虚设。
   */
  async resolveCurrentStoreId(
    userId: number,
    stores: ClubAccessibleStoreRecord[],
  ): Promise<number | null> {
    return this.resolveCurrentStoreIdFromValue(
      userId,
      stores,
      await this.readSelectedStoreId(userId),
    );
  }

  /** 选店决策本体；选中值由调用方提供，避免合并读取路径重复一次 Redis GET */
  private async resolveCurrentStoreIdFromValue(
    userId: number,
    stores: ClubAccessibleStoreRecord[],
    selectedStoreId: number | null,
  ): Promise<number | null> {
    if (stores.length === 0) {
      return null;
    }

    const hasSelectedStore =
      selectedStoreId !== null &&
      stores.some((store) => store.id === selectedStoreId);

    if (hasSelectedStore) {
      return selectedStoreId;
    }

    if (stores.length > 1) {
      // 缓存指向已不可访问的门店时清掉，避免下次误读到别人的店
      if (selectedStoreId !== null) {
        await this.clearSelectedStoreId(userId);
      }
      return null;
    }

    const onlyStoreId = stores[0].id;
    await this.persistSelectedStoreId(userId, onlyStoreId);
    return onlyStoreId;
  }

  async clearSelectedStoreId(userId: number): Promise<void> {
    this.clubCurrentContextCache.delete(userId);
    await this.redisService.del(this.buildSelectedStoreKey(userId));
  }

  /**
   * 选店页组合读取：一次 MGET 同时取回「可访问门店」与「已选门店」，再据此定夺当前门店。
   *
   * 原 `/club/stores` 走的是 findAccessibleStores（1 次 GET）+ resolveCurrentStoreId
   * （再 1 次 GET 同一个选中门店 key），两次往返读的本来就是同一批 key。
   * 复用 loadAccessSnapshot 后固定 1 次 MGET。
   *
   * 返回 `currentStoreId = null` 表示「需要用户显式选店」，语义与 resolveCurrentStoreId 一致。
   */
  async resolveStoresAndCurrentStoreId(user: AuthenticatedUser): Promise<{
    stores: ClubAccessibleStoreRecord[];
    currentStoreId: number | null;
  }> {
    const snapshot = await this.loadAccessSnapshot(user);
    const currentStoreId =
      snapshot.stores.length === 0
        ? null
        : await this.resolveCurrentStoreIdFromValue(
            user.id,
            snapshot.stores,
            snapshot.selectedStoreId,
          );
    return { stores: snapshot.stores, currentStoreId };
  }

  private async readSelectedStoreId(userId: number): Promise<number | null> {
    return this.parseSelectedStoreId(
      await this.redisService.get(this.buildSelectedStoreKey(userId)),
    );
  }

  private parseSelectedStoreId(rawStoreId: string | null): number | null {
    if (!rawStoreId || rawStoreId.trim().length === 0) {
      return null;
    }

    const parsedStoreId = Number.parseInt(rawStoreId, 10);
    return Number.isNaN(parsedStoreId) ? null : parsedStoreId;
  }

  private async persistSelectedStoreId(
    userId: number,
    storeId: number,
  ): Promise<void> {
    // 选中门店变化后必须清掉进程内快照：TTL 窗口内继续返回旧门店，
    // 会让「切换门店后立刻下单」打到上一家店。
    this.clubCurrentContextCache.delete(userId);
    await this.redisService.set(
      this.buildSelectedStoreKey(userId),
      `${storeId}`,
      CLUB_SELECTED_STORE_TTL_SECONDS,
    );
  }

  private buildSelectedStoreKey(userId: number): string {
    return `${CLUB_SELECTED_STORE_KEY_PREFIX}${userId}`;
  }
}
