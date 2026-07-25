import { Injectable } from '@nestjs/common';
import { STORE_SUB_ACCOUNT_ROLE_LABELS } from '../access-control/access-control.constants';
import { AccessControlService } from '../access-control/access-control.service';
import { SubjectCapabilityService } from '../access-control/subject-capability.service';
import { PlatformMembershipAccessService } from '../member/platform-membership/platform-membership-access.service';
import { StoreBusinessCapabilityService } from '../stores/store-business-capability.service';
import type { AuthenticatedUser } from './strategies/jwt.strategy';
import type { AuthCapabilityResponseDto } from './dto/capability-response.dto';

/**
 * 认证能力服务。
 *
 * 职责：
 * 1. 构建账号/角色级别的 capability 快照（由 SubjectCapabilityService 承担）
 * 2. 从 StoreBusinessCapabilityService 获取门店业态能力（唯一事实来源）
 * 3. 将账号权限与门店业态能力叠加：
 *    最终 capability = 账号权限 capability && 门店业态 capability
 *
 * 硬性规则：
 * - 不允许直接查询 Prisma.store 推导业态
 * - 业态能力来源只能为 StoreBusinessCapabilityService
 * - 数据库异常、门店不存在、缓存缺失时，所有受业态限制的能力均为 false
 */
@Injectable()
export class AuthCapabilityService {
  constructor(
    private readonly subjectCapabilityService: SubjectCapabilityService,
    private readonly platformMembershipAccessService: PlatformMembershipAccessService,
    private readonly storeBusinessCapabilityService: StoreBusinessCapabilityService,
    private readonly accessControlService: AccessControlService,
  ) {}

  async getCapability(
    user: AuthenticatedUser,
  ): Promise<AuthCapabilityResponseDto> {
    const storeId = user.currentMembership?.storeId;
    const subAccountQuota = storeId
      ? await this.platformMembershipAccessService.getSubAccountQuota(storeId)
      : 0;
    const snapshot = this.subjectCapabilityService.buildSnapshot(
      user.currentMembership,
      subAccountQuota,
    );

    // 业态能力：从 StoreBusinessCapabilityService 获取（唯一事实来源）
    // 数据库查询失败、门店不存在时，所有受业态限制的能力全部返回 false（最小权限原则）
    const businessCapabilities =
      await this.storeBusinessCapabilityService.getCapabilities(user);

    // 解析账号级别权限：检查是否具备扫码点餐相关权限
    const effectivePermissions = user.currentMembership
      ? this.accessControlService.getEffectivePermissions(
          user.currentMembership,
        )
      : [];
    const hasScanOrderingViewPermission =
      this.accessControlService.hasPermission(
        effectivePermissions,
        'scan-ordering:view',
      );
    const hasScanOrderingMenuManagePermission =
      this.accessControlService.hasPermission(
        effectivePermissions,
        'scan-ordering:menu-manage',
      );

    return {
      identityType: snapshot.identityType,
      ...(snapshot.subAccountRole
        ? {
            subAccountRole: snapshot.subAccountRole,
            subAccountRoleLabel:
              STORE_SUB_ACCOUNT_ROLE_LABELS[snapshot.subAccountRole],
            ...(user.currentMembership?.subAccountStatus
              ? { subAccountStatus: user.currentMembership.subAccountStatus }
              : {}),
            ...(user.currentMembership?.subAccountAssigned !== undefined
              ? {
                  subAccountAssigned: user.currentMembership.subAccountAssigned,
                }
              : {}),
            ...(user.currentMembership?.canAccessHome !== undefined
              ? { canAccessHome: user.currentMembership.canAccessHome }
              : {}),
            ...(user.currentMembership?.canUseHandover !== undefined
              ? { canUseHandover: user.currentMembership.canUseHandover }
              : {}),
          }
        : {}),
      subAccountQuota: snapshot.subAccountQuota,
      subAccountEnabled: snapshot.subAccountEnabled,
      allowedHomeModules: snapshot.allowedHomeModules,
      hiddenHomeModules: snapshot.hiddenHomeModules,
      canViewFinance: snapshot.canViewFinance,
      canViewMarketing: snapshot.canViewMarketing,
      canUseGoodsManagement: snapshot.canUseGoodsManagement,
      canUseHandoverManagement: snapshot.canUseHandoverManagement,
      // 业态叠加：最终 capability = 账号权限 && 门店业态
      canUseSpaceManagement:
        snapshot.canUseSpaceManagement &&
        businessCapabilities.canUseSpaceManagement,
      canAccessStoreSettings: snapshot.canAccessStoreSettings,
      // ─── 业态能力 ───
      businessMode: businessCapabilities.businessMode,
      isCateringStore: businessCapabilities.isCateringStore,
      isGeneralStore: businessCapabilities.isGeneralStore,
      canUseScanOrdering:
        hasScanOrderingViewPermission &&
        businessCapabilities.canUseScanOrdering,
      canManageScanOrderingMenu:
        hasScanOrderingMenuManagePermission &&
        businessCapabilities.canManageScanOrderingMenu,
      canUseMarketingProductListing:
        snapshot.canViewMarketing &&
        businessCapabilities.canUseMarketingProductListing,
    };
  }
}
