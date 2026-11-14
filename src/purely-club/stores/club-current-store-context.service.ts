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
    const stores = await this.clubStoreAccessService.findAccessibleStores(user);
    if (stores.length === 0) {
      return this.throwStoreSelectionRequired(user.id);
    }

    const currentStoreId = await this.resolveCurrentStoreId(user.id, stores);
    if (currentStoreId === null) {
      // 多门店且没有有效选店：不能隐式落到第一个门店。充值、储值、下单、
      // 查余额全部以 currentStore 为准，静默回落会把钱记到用户没选的那家店。
      // 复用同一业务码，让前端既有的「清缓存 + 跳门店选择页」兜底生效。
      return this.throwStoreSelectionRequired(user.id);
    }

    return stores.find((store) => store.id === currentStoreId) ?? stores[0];
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
    if (stores.length === 0) {
      return null;
    }

    const selectedStoreId = await this.readSelectedStoreId(userId);
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
    await this.redisService.del(this.buildSelectedStoreKey(userId));
  }

  private async readSelectedStoreId(userId: number): Promise<number | null> {
    const rawStoreId = await this.redisService.get(
      this.buildSelectedStoreKey(userId),
    );
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
