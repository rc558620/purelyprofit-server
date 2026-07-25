import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import type { StoreBusinessMode } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import type { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

/**
 * 门店业态能力快照。
 * 所有字段都基于门店 businessMode 推导，与角色/权限无关。
 * 最终可访问 = 业态允许 && 原有账号权限允许。
 */
export interface StoreBusinessCapability {
  /** 门店业态 */
  businessMode: 'catering' | 'general';
  /** 是否为餐饮门店 */
  isCateringStore: boolean;
  /** 是否为非餐饮门店 */
  isGeneralStore: boolean;
  /** 是否可使用扫码点餐（仅餐饮） */
  canUseScanOrdering: boolean;
  /** 是否可管理扫码点餐菜单（仅餐饮） */
  canManageScanOrderingMenu: boolean;
  /** 是否可使用空间管理（仅非餐饮） */
  canUseSpaceManagement: boolean;
  /** 是否可使用营销商品上架（仅非餐饮） */
  canUseMarketingProductListing: boolean;
}

/**
 * 门店业态统一能力判定服务。
 *
 * 职责：
 * 1. 根据当前认证用户解析所属门店
 * 2. 从数据库读取门店 businessMode
 * 3. 合并业态、角色、权限，统一计算功能能力
 * 4. 提供统一断言方法，避免业务模块重复判断
 *
 * 硬性规则：
 * - 判断依据是门店注册业态，不是当前账号类型
 * - 一个门店的所有账号共享同一业态规则
 * - 原有角色/权限控制仍然保留，与业态规则叠加
 */
@Injectable()
export class StoreBusinessCapabilityService {
  private readonly logger = new Logger(StoreBusinessCapabilityService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * 获取当前用户的门店业态能力快照。
   * 当用户未绑定门店或数据库查询失败时，返回安全默认值（全部为 false）。
   */
  async getCapabilities(
    user: AuthenticatedUser,
  ): Promise<StoreBusinessCapability> {
    const storeId = user.currentMembership?.storeId;

    if (!storeId) {
      return this.buildSafeDefault();
    }

    const businessMode = await this.resolveStoreBusinessMode(storeId);

    return this.buildCapabilities(businessMode);
  }

  /**
   * 根据 storeId 获取门店业态能力快照。
   */
  async getCapabilitiesByStoreId(
    storeId: number,
  ): Promise<StoreBusinessCapability> {
    const businessMode = await this.resolveStoreBusinessMode(storeId);
    return this.buildCapabilities(businessMode);
  }

  /**
   * 断言当前门店为餐饮门店，否则抛出 403。
   */
  async ensureCateringStore(user: AuthenticatedUser): Promise<void> {
    const capabilities = await this.getCapabilities(user);
    if (!capabilities.isCateringStore) {
      throw new ForbiddenException('该功能仅适用于餐饮门店');
    }
  }

  /**
   * 断言当前门店为非餐饮门店，否则抛出 403。
   */
  async ensureGeneralStore(user: AuthenticatedUser): Promise<void> {
    const capabilities = await this.getCapabilities(user);
    if (!capabilities.isGeneralStore) {
      throw new ForbiddenException('该功能仅适用于非餐饮门店');
    }
  }

  /**
   * 断言当前门店可使用扫码点餐，否则抛出 403。
   */
  async ensureScanOrderingAccess(user: AuthenticatedUser): Promise<void> {
    const capabilities = await this.getCapabilities(user);
    if (!capabilities.canUseScanOrdering) {
      throw new ForbiddenException('扫码点餐功能仅适用于餐饮门店');
    }
  }

  /**
   * 断言当前门店可使用空间管理，否则抛出 403。
   */
  async ensureSpaceManagementAccess(user: AuthenticatedUser): Promise<void> {
    const capabilities = await this.getCapabilities(user);
    if (!capabilities.canUseSpaceManagement) {
      throw new ForbiddenException('空间管理功能仅适用于非餐饮门店');
    }
  }

  /**
   * 断言当前门店可使用营销商品上架，否则抛出 403。
   */
  async ensureMarketingProductListingAccess(
    user: AuthenticatedUser,
  ): Promise<void> {
    const capabilities = await this.getCapabilities(user);
    if (!capabilities.canUseMarketingProductListing) {
      throw new ForbiddenException('营销产品上架功能仅适用于非餐饮门店');
    }
  }

  /**
   * 从数据库读取门店 businessMode。
   * 数据库是唯一事实源，不依赖 Redis 缓存。
   */
  private async resolveStoreBusinessMode(
    storeId: number,
  ): Promise<StoreBusinessMode | null> {
    try {
      const store = await this.prisma.store.findUnique({
        where: { id: storeId },
        select: { businessMode: true },
      });

      if (!store) {
        this.logger.warn(`门店 ${storeId} 不存在，业态能力回退到安全默认值`);
        return null;
      }

      return store.businessMode;
    } catch (error: unknown) {
      this.logger.error(
        `读取门店 ${storeId} 业态失败，回退到安全默认值: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /**
   * 根据业态构建能力快照。
   * 未知状态（null）时所有受限制功能全部为 false（最小权限原则）。
   */
  private buildCapabilities(
    businessMode: StoreBusinessMode | null,
  ): StoreBusinessCapability {
    // 数据库查询失败或门店不存在时，所有受业态限制的能力全部返回 false
    const isBusinessModeKnown = businessMode !== null;
    const isCatering = businessMode === 'catering';
    const isGeneral = isBusinessModeKnown && !isCatering;

    return {
      businessMode: businessMode ?? 'general',
      isCateringStore: isCatering,
      isGeneralStore: isGeneral,
      canUseScanOrdering: isCatering,
      canManageScanOrderingMenu: isCatering,
      canUseSpaceManagement: isGeneral,
      canUseMarketingProductListing: isGeneral,
    };
  }

  /**
   * 安全默认值：能力未知时，所有功能全部不开放（最小权限原则）。
   */
  private buildSafeDefault(): StoreBusinessCapability {
    return {
      businessMode: 'general',
      isCateringStore: false,
      isGeneralStore: false,
      canUseScanOrdering: false,
      canManageScanOrderingMenu: false,
      canUseSpaceManagement: false,
      canUseMarketingProductListing: false,
    };
  }
}
