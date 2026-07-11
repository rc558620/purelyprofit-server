# API 接口文档

<cite>
**本文档引用的文件**
- [src/main.ts](file://src/main.ts)
- [src/app.module.ts](file://src/app.module.ts)
- [src/app.controller.ts](file://src/app.controller.ts)
- [src/purely-profit/auth/auth.controller.ts](file://src/purely-profit/auth/auth.controller.ts)
- [src/purely-profit/auth/auth.service.ts](file://src/purely-profit/auth/auth.service.ts)
- [src/purely-profit/auth/auth.module.ts](file://src/purely-profit/auth/auth.module.ts)
- [src/purely-profit/auth/guards/jwt-auth.guard.ts](file://src/purely-profit/auth/guards/jwt-auth.guard.ts)
- [src/purely-profit/auth/strategies/jwt.strategy.ts](file://src/purely-profit/auth/strategies/jwt.strategy.ts)
- [src/purely-profit/auth/dto/login.dto.ts](file://src/purely-profit/auth/dto/login.dto.ts)
- [src/purely-profit/auth/dto/register.dto.ts](file://src/purely-profit/auth/dto/register.dto.ts)
- [src/purely-profit/auth/dto/auth-token-response.dto.ts](file://src/purely-profit/auth/dto/auth-token-response.dto.ts)
- [src/purely-profit/auth/dto/profile-response.dto.ts](file://src/purely-profit/auth/dto/profile-response.dto.ts)
- [src/purely-profit/auth/dto/capability-response.dto.ts](file://src/purely-profit/auth/dto/capability-response.dto.ts)
- [src/purely-profit/auth/dto/change-password.dto.ts](file://src/purely-profit/auth/dto/change-password.dto.ts)
- [src/purely-profit/auth/dto/forgot-password.dto.ts](file://src/purely-profit/auth/dto/forgot-password.dto.ts)
- [src/purely-profit/auth/dto/reset-password.dto.ts](file://src/purely-profit/auth/dto/reset-password.dto.ts)
- [src/purely-profit/auth/dto/send-register-code.dto.ts](file://src/purely-profit/auth/dto/send-register-code.dto.ts)
- [src/purely-profit/auth/dto/send-register-code-response.dto.ts](file://src/purely-profit/auth/dto/send-register-code-response.dto.ts)
- [src/purely-profit/auth/dto/update-avatar.dto.ts](file://src/purely-profit/auth/dto/update-avatar.dto.ts)
- [src/purely-profit/auth/dto/verify-real-name.dto.ts](file://src/purely-profit/auth/dto/verify-real-name.dto.ts)
- [src/purely-profit/notifications/notifications.controller.ts](file://src/purely-profit/notifications/notifications.controller.ts)
- [src/purely-profit/notifications/notifications.service.ts](file://src/purely-profit/notifications/notifications.service.ts)
- [src/purely-profit/notifications/dto/notifications.dto.ts](file://src/purely-profit/notifications/dto/notifications.dto.ts)
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts)
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts)
- [src/purely-profit/dashboard/business-analysis/business-analysis.controller.ts](file://src/purely-profit/dashboard/business-analysis/business-analysis.controller.ts)
- [src/purely-profit/dashboard/business-analysis/business-analysis.service.ts](file://src/purely-profit/dashboard/business-analysis/business-analysis.service.ts)
- [src/purely-profit/dashboard/profit-detail/profit-detail.controller.ts](file://src/purely-profit/dashboard/profit-detail/profit-detail.controller.ts)
- [src/purely-profit/dashboard/profit-detail/profit-detail.service.ts](file://src/purely-profit/dashboard/profit-detail/profit-detail.service.ts)
- [src/purely-profit/finance/finance.controller.ts](file://src/purely-profit/finance/finance.controller.ts)
- [src/purely-profit/finance/finance.service.ts](file://src/purely-profit/finance/finance.service.ts)
- [src/purely-profit/goods/products/products.controller.ts](file://src/purely-profit/goods/products/products.controller.ts)
- [src/purely-profit/goods/products/products.service.ts](file://src/purely-profit/goods/products/products.service.ts)
- [src/purely-profit/goods/inventory/inventory.controller.ts](file://src/purely-profit/goods/inventory/inventory.controller.ts)
- [src/purely-profit/goods/inventory/inventory.service.ts](file://src/purely-profit/goods/inventory/inventory.service.ts)
- [src/purely-profit/goods/categories/categories.controller.ts](file://src/purely-profit/goods/categories/categories.controller.ts)
- [src/purely-profit/goods/categories/categories.service.ts](file://src/purely-profit/goods/categories/categories.service.ts)
- [src/purely-profit/marketing/marketing.controller.ts](file://src/purely-profit/marketing/marketing.controller.ts)
- [src/purely-profit/marketing/marketing.service.ts](file://src/purely-profit/marketing/marketing.service.ts)
- [src/purely-profit/marketing/marketing-customers.controller.ts](file://src/purely-profit/marketing/marketing-customers.controller.ts)
- [src/purely-profit/marketing/marketing-overview.controller.ts](file://src/purely-profit/marketing/marketing-overview.controller.ts)
- [src/purely-profit/marketing/marketing-products.controller.ts](file://src/purely-profit/marketing/marketing-products.controller.ts)
- [src/purely-profit/marketing/marketing-promotions.controller.ts](file://src/purely-profit/marketing/marketing-promotions.controller.ts)
- [src/purely-profit/marketing/marketing-transactions.controller.ts](file://src/purely-profit/marketing/marketing-transactions.controller.ts)
- [src/purely-profit/member/members/members.controller.ts](file://src/purely-profit/member/members/members.controller.ts)
- [src/purely-profit/member/members/members.service.ts](file://src/purely-profit/member/members/members.service.ts)
- [src/purely-profit/member/platform-membership/platform-membership.controller.ts](file://src/purely-profit/member/platform-membership/platform-membership.controller.ts)
- [src/purely-profit/member/platform-membership/platform-membership.service.ts](file://src/purely-profit/member/platform-membership/platform-membership.service.ts)
- [src/purely-profit/member/platform-membership/partner-review.controller.ts](file://src/purely-profit/member/platform-membership/partner-review.controller.ts)
- [src/purely-profit/member/platform-membership/promotion-detail-compat.controller.ts](file://src/purely-profit/member/platform-membership/promotion-detail-compat.controller.ts)
- [src/purely-profit/subscriptions/subscriptions.controller.ts](file://src/purely-profit/subscriptions/subscriptions.controller.ts)
- [src/purely-profit/subscriptions/subscriptions.service.ts](file://src/purely-profit/subscriptions/subscriptions.service.ts)
- [src/purely-profit/stores/stores.controller.ts](file://src/purely-profit/stores/stores.controller.ts)
- [src/purely-profit/stores/stores.service.ts](file://src/purely-profit/stores/stores.service.ts)
- [src/purely-profit/operations/sales-record/sales-record.controller.ts](file://src/purely-profit/operations/sales-record/sales-record.controller.ts)
- [src/purely-profit/operations/sales-record/sales-record.service.ts](file://src/purely-profit/operations/sales-record/sales-record.service.ts)
- [src/purely-profit/operations/handover/handover.controller.ts](file://src/purely-profit/operations/handover/handover.controller.ts)
- [src/purely-profit/operations/handover/handover.service.ts](file://src/purely-profit/operations/handover/handover.service.ts)
- [src/purely-profit/operations/spaces/spaces.controller.ts](file://src/purely-profit/operations/spaces/spaces.controller.ts)
- [src/purely-profit/operations/spaces/spaces.service.ts](file://src/purely-profit/operations/spaces/spaces.service.ts)
- [src/purely-profit/operations/spaces/space-sessions.controller.ts](file://src/purely-profit/operations/spaces/space-sessions.controller.ts)
- [src/purely-profit/staff/employees/employees.controller.ts](file://src/purely-profit/staff/employees/employees.controller.ts)
- [src/purely-profit/staff/employees/employees.service.ts](file://src/purely-profit/staff/employees/employees.service.ts)
- [src/purely-profit/staff/seats/seats.controller.ts](file://src/purely-profit/staff/seats/seats.controller.ts)
- [src/purely-profit/staff/seats/seats.service.ts](file://src/purely-profit/staff/seats/seats.service.ts)
- [src/purely-profit/finance/dto/finance-response.dto.ts](file://src/purely-profit/finance/dto/finance-response.dto.ts)
- [src/purely-profit/finance/dto/finance-query.dto.ts](file://src/purely-profit/finance/dto/finance-query.dto.ts)
- [src/purely-profit/finance/dto/finance-overview.response.dto.ts](file://src/purely-profit/finance/dto/finance-overview.response.dto.ts)
- [src/purely-profit/finance/dto/finance-account.response.dto.ts](file://src/purely-profit/finance/dto/finance-account.response.dto.ts)
- [src/purely-profit/finance/dto/finance-cash-flow.response.dto.ts](file://src/purely-profit/finance/dto/finance-cash-flow.response.dto.ts)
- [src/purely-profit/finance/dto/finance-reconciliation.response.dto.ts](file://src/purely-profit/finance/dto/finance-reconciliation.response.dto.ts)
- [src/purely-profit/finance/dto/finance-report.response.dto.ts](file://src/purely-profit/finance/dto/finance-report.response.dto.ts)
- [src/purely-profit/finance/dto/finance-account.query.dto.ts](file://src/purely-profit/finance/dto/finance-account.query.dto.ts)
- [src/purely-profit/finance/dto/finance-cash-flow.query.dto.ts](file://src/purely-profit/finance/dto/finance-cash-flow.query.dto.ts)
- [src/purely-profit/finance/dto/finance-reconciliation.query.dto.ts](file://src/purely-profit/finance/dto/finance-reconciliation.query.dto.ts)
- [src/purely-profit/finance/dto/finance-overview.query.dto.ts](file://src/purely-profit/finance/dto/finance-overview.query.dto.ts)
- [src/purely-profit/goods/products/dto/products-query.dto.ts](file://src/purely-profit/goods/products/dto/products-query.dto.ts)
- [src/purely-profit/goods/inventory/dto/inventory-query.dto.ts](file://src/purely-profit/goods/inventory/dto/inventory-query.dto.ts)
- [src/purely-profit/goods/categories/dto/categories-query.dto.ts](file://src/purely-profit/goods/categories/dto/categories-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-pagination-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-pagination-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-consumption-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-consumption-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-customer-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-customer-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-product.dto.ts](file://src/purely-profit/marketing/dto/marketing-product.dto.ts)
- [src/purely-profit/marketing/dto/marketing-promotion-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-promotion-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-recharge-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-recharge-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-response.dto.ts](file://src/purely-profit/marketing/dto/marketing-response.dto.ts)
- [src/purely-profit/member/members/dto/members-query.dto.ts](file://src/purely-profit/member/members/dto/members-query.dto.ts)
- [src/purely-profit/member/members/dto/members-create.dto.ts](file://src/purely-profit/member/members/dto/members-create.dto.ts)
- [src/purely-profit/member/members/dto/members-update.dto.ts](file://src/purely-profit/member/members/dto/members-update.dto.ts)
- [src/purely-profit/member/members/dto/members-response.dto.ts](file://src/purely-profit/member/members/dto/members-response.dto.ts)
- [src/purely-profit/subscriptions/dto/subscriptions-query.dto.ts](file://src/purely-profit/subscriptions/dto/subscriptions-query.dto.ts)
- [src/purely-profit/subscriptions/dto/subscriptions-response.dto.ts](file://src/purely-profit/subscriptions/dto/subscriptions-response.dto.ts)
- [src/purely-profit/stores/dto/stores-query.dto.ts](file://src/purely-profit/stores/dto/stores-query.dto.ts)
- [src/purely-profit/stores/dto/stores-response.dto.ts](file://src/purely-profit/stores/dto/stores-response.dto.ts)
- [src/purely-profit/operations/sales-record/dto/sales-record-query.dto.ts](file://src/purely-profit/operations/sales-record/dto/sales-record-query.dto.ts)
- [src/purely-profit/operations/handover/dto/handover-query.dto.ts](file://src/purely-profit/operations/handover/dto/handover-query.dto.ts)
- [src/purely-profit/operations/spaces/dto/spaces-query.dto.ts](file://src/purely-profit/operations/spaces/dto/spaces-query.dto.ts)
- [src/purely-profit/staff/employees/dto/employees-query.dto.ts](file://src/purely-profit/staff/employees/dto/employees-query.dto.ts)
- [src/purely-profit/staff/seats/dto/seats-query.dto.ts](file://src/purely-profit/staff/seats/dto/seats-query.dto.ts)
- [src/purely-profit/access-control/access-control.service.ts](file://src/purely-profit/access-control/access-control.service.ts)
- [src/purely-profit/access-control/guards/permissions.guard.ts](file://src/purely-profit/access-control/guards/permissions.guard.ts)
- [src/purely-profit/access-control/decorators/require-permissions.decorator.ts](file://src/purely-profit/access-control/decorators/require-permissions.decorator.ts)
- [src/purely-profit/access-control/decorators/block-sub-account.decorator.ts](file://src/purely-profit/access-control/decorators/block-sub-account.decorator.ts)
- [src/purely-profit/commerce/commerce-access.service.ts](file://src/purely-profit/commerce/commerce-access.service.ts)
- [src/purely-profit/finance/finance-access.service.ts](file://src/purely-profit/finance/finance-access.service.ts)
- [src/purely-profit/goods/categories/categories-read.service.ts](file://src/purely-profit/goods/categories/categories-read.service.ts)
- [src/purely-profit/goods/categories/categories-write.service.ts](file://src/purely-profit/goods/categories/categories-write.service.ts)
- [src/purely-profit/goods/inventory/inventory-stock.domain.ts](file://src/purely-profit/goods/inventory/inventory-stock.domain.ts)
- [src/purely-profit/goods/products/products.domain.ts](file://src/purely-profit/goods/products/products.domain.ts)
- [src/purely-profit/marketing/marketing-access.service.ts](file://src/purely-profit/marketing/marketing-access.service.ts)
- [src/purely-profit/member/platform-membership/platform-membership-access.service.ts](file://src/purely-profit/member/platform-membership/platform-membership-access.service.ts)
- [src/purely-profit/subscriptions/subscriptions-access.service.ts](file://src/purely-profit/subscriptions/subscriptions-access.service.ts)
- [src/purely-profit/stores/stores-read.service.ts](file://src/purely-profit/stores/stores-read.service.ts)
- [src/purely-profit/stores/stores-write.service.ts](file://src/purely-profit/stores/stores-write.service.ts)
- [src/purely-profit/operations/sales-record/sales-record.domain.ts](file://src/purely-profit/operations/sales-record/sales-record.domain.ts)
- [src/purely-profit/operations/handover/handover.domain.ts](file://src/purely-profit/operations/handover/handover.domain.ts)
- [src/purely-profit/operations/spaces/spaces.domain.ts](file://src/purely-profit/operations/spaces/spaces.domain.ts)
- [src/purely-profit/staff/employees/employees.domain.ts](file://src/purely-profit/staff/employees/employees.domain.ts)
- [src/purely-profit/staff/seats/seats.domain.ts](file://src/purely-profit/staff/seats/seats.domain.ts)
- [src/purely-profit/member/members/members-access.service.ts](file://src/purely-profit/member/members/members-access.service.ts)
- [src/purely-profit/member/members/members-points.service.ts](file://src/purely-profit/member/members/members-points.service.ts)
- [src/purely-profit/member/members/members-points.query.ts](file://src/purely-profit/member/members/members-points.query.ts)
- [src/purely-profit/member/platform-membership/platform-membership-ledger.service.ts](file://src/purely-profit/member/platform-membership/platform-membership-ledger.service.ts)
- [src/purely-profit/member/platform-membership/platform-membership-order.service.ts](file://src/purely-profit/member/platform-membership/platform-membership-order.service.ts)
- [src/purely-profit/member/platform-membership/store-sub-account.service.ts](file://src/purely-profit/member/platform-membership/store-sub-account.service.ts)
- [src/purely-profit/member/platform-membership/store-sub-account-slot.service.ts](file://src/purely-profit/member/platform-membership/store-sub-account-slot.service.ts)
- [src/purely-profit/member/platform-membership/store-sub-account-login.service.ts](file://src/purely-profit/member/platform-membership/store-sub-account-login.service.ts)
- [src/purely-profit/member/platform-membership/store-sub-account-read.service.ts](file://src/purely-profit/member/platform-membership/store-sub-account-read.service.ts)
- [src/purely-profit/member/platform-membership/store-sub-account.types.ts](file://src/purely-profit/member/platform-membership/store-sub-account.types.ts)
- [src/purely-profit/member/platform-membership/platform-membership-partner.service.ts](file://src/purely-profit/member/platform-membership/platform-membership-partner.service.ts)
- [src/purely-profit/member/platform-membership/platform-membership-partner-application.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-partner-application.domain.ts)
- [src/purely-profit/member/platform-membership/platform-membership-partner-profile.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-partner-profile.domain.ts)
- [src/purely-profit/member/platform-membership/platform-membership-partner-review.compat.ts](file://src/purely-profit/member/platform-membership/platform-membership-partner-review.compat.ts)
- [src/purely-profit/member/platform-membership/platform-membership-partner.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-partner.domain.ts)
- [src/purely-profit/member/platform-membership/platform-membership-profile.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-profile.domain.ts)
- [src/purely-profit/member/platform-membership/platform-membership-promo.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-promo.domain.ts)
- [src/purely-profit/member/platform-membership/platform-membership-promo-stats.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-promo-stats.domain.ts)
- [src/purely-profit/member/platform-membership/platform-membership-promo-compat.domain.ts](file://src/purely-profit/member/platform-membership/platform-membership-promo-compat.domain.ts)
- [src/purely-profit/member/platform-membership/membership-expiry.utils.ts](file://src/purely-profit/member/platform-membership/membership-expiry.utils.ts)
- [src/purely-profit/member/platform-membership/membership-plan-resolver.ts](file://src/purely-profit/member/platform-membership/membership-plan-resolver.ts)
- [src/purely-profit/member/platform-membership/membership-profile.mapper.ts](file://src/purely-profit/member/platform-membership/membership-profile.mapper.ts)
- [src/purely-profit/member/platform-membership/platform-membership.constants.ts](file://src/purely-profit/member/platform-membership/platform-membership.constants.ts)
- [src/purely-profit/member/platform-membership/platform-membership.types.ts](file://src/purely-profit/member/platform-membership/platform-membership.types.ts)
- [src/purely-profit/member/platform-membership/platform-membership.query.ts](file://src/purely-profit/member/platform-membership/platform-membership.query.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-utils.ts](file://src/purely-profit/member/members/members-utils.ts)
- [src/purely-profit/member/members/members-types.ts](file://src/purely-profit/member/members/members-types.ts)
- [src/purely-profit/member/members/members-access.service.ts](file://src/purely-profit/member/members/members-access.service.ts)
- [src/purely-profit/member/members/members.service.ts](file://src/purely-profit/member/members/members.service.ts)
- [src/purely-profit/member/members/members.controller.ts](file://src/purely-profit/member/members/members.controller.ts)
- [src/purely-profit/member/members/members-points.service.ts](file://src/purely-profit/member/members/members-points.service.ts)
- [src/purely-profit/member/members/members-points.query.ts](file://src/purely-profit/member/members/members-points.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-points.config.ts](file://src/purely-profit/member/members/members-points.config.ts)
- [src/purely-profit/member/members/members.snapshot.mapper.ts](file://src/purely-profit/member/members/members.snapshot.mapper.ts)
- [src/purely-profit/member/members/members.types.ts](file://src/purely-profit/member/members/members.types.ts)
- [src/purely-profit/member/members/members.utils.ts](file://src/purely-profit/member/members/members.utils.ts)
- [src/purely-profit/member/members/members-query.shared.ts](file://src/purely-profit/member/members/members-query.shared.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/members.domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-points.config.ts](file://src/purely-profit/member/members/members-points.config.ts)
- [src/purely-profit/member/members/members.snapshot.mapper.ts](file://src/purely-profit/member/members/members.snapshot.mapper.ts)
- [src/purely-profit/member/members/members.types.ts](file://src/purely-profit/member/members/members.types.ts)
- [src/purely-profit/member/members/members.utils.ts](file://src/purely-profit/member/members/members.utils.ts)
- [src/purely-profit/member/members/members-query.shared.ts](file://src/purely-profit/member/members/members-query.shared.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/members.domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-points.config.ts](file://src/purely-profit/member/members/members-points.config.ts)
- [src/purely-profit/member/members/members.snapshot.mapper.ts](file://src/purely-profit/member/members/members.snapshot.mapper.ts)
- [src/purely-profit/member/members/members.types.ts](file://src/purely-profit/member/members/members.types.ts)
- [src/purely-profit/member/members/members.utils.ts](file://src/purely-profit/member/members/members.utils.ts)
- [src/purely-profit/member/members/members-query.shared.ts](file://src/purely-profit/member/members/members-query.shared.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/members.domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-points.config.ts](file://src/purely-profit/member/members/members-points.config.ts)
- [src/purely-profit/member/members/members.snapshot.mapper.ts](file://src/purely-profit/member/members/members.snapshot.mapper.ts)
- [src/purely-profit/member/members/members.types.ts](file://src/purely-profit/member/members/members.types.ts)
- [src/purely-profit/member/members/members.utils.ts](file://src/purely-profit/member/members/members.utils.ts)
- [src/purely-profit/member/members/members-query.shared.ts](file://src/purely-profit/member/members/members-query.shared.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/members.domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-points.config.ts](file://src/purely-profit/member/members/members-points.config.ts)
- [src/purely-profit/member/members/members.snapshot.mapper.ts](file://src/purely-profit/member/members/members.snapshot.mapper.ts)
- [src/purely-profit/member/members/members.types.ts](file://src/purely-profit/member/members/members.types.ts)
- [src/purely-profit/member/members/members.utils.ts](file://src/purely-profit/member/members/members.utils.ts)
- [src/purely-profit/member/members/members-query.shared.ts](file://src/purely-profit/member/members/members-query.shared.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/members.domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members-points.mapper.ts](file://src/purely-profit/member/members/members-points.mapper.ts)
- [src/purely-profit/member/members/members-points.shared.ts](file://src/purely-profit/member/members/members-points.shared.ts)
- [src/purely-profit/member/members/members-points.config.ts](file://src/purely-profit/member/members/members-points.config.ts)
- [src/purely-profit/member/members/members.snapshot.mapper.ts](file://src/purely-profit/member/members/members.snapshot.mapper.ts)
- [src/purely-profit/member/members/members.types.ts](file://src/purely-profit/member/members/members.types.ts)
- [src/purely-profit/member/members/members.utils.ts](file://src/purely-profit/member/members/members.utils.ts)
- [src/purely-profit/member/members/members-query.shared.ts](file://src/purely-profit/member/members/members-query.shared.ts)
- [src/purely-profit/member/members/members.domain.ts](file://src/purely-profit/member/members/members.domain.ts)
- [src/purely-profit/member/members/members.mapper.ts](file://src/purely-profit/member/members/members.mapper.ts)
- [src/purely-profit/member/members/members.query.ts](file://src/purely-profit/member/members/members.query.ts)
- [src/purely-profit/member/members/members-read.query.ts](file://src/purely-profit/member/members/members-read.query.ts)
- [src/purely-profit/member/members/members-write.query.ts](file://src/purely-profit/member/members/members-write.query.ts)
- [src/purely-profit/member/members/members......
- [src/purely-profit/operations/spaces/dto/space-session-checkout.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-checkout.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-open.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-open.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-preview.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-preview.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-renew.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-renew.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-shared.response.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-shared.response.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session.constants.ts](file://src/purely-profit/operations/spaces/dto/space-session.constants.ts)
</cite>

## 更新摘要
**变更内容**   
- 扩展空间会话相关接口以支持团购平台字段
- 新增多个DTO文件的团购平台参数验证和类型定义
- 响应DTO暴露新的结算字段用于平台结算管理
- 完善空间会话开台、结账、续费等核心业务流程的团购平台支持

## 目录
1. [简介](#简介)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能考量](#性能考量)
8. [故障排查指南](#故障排查指南)
9. [结论](#结论)
10. [附录](#附录)

## 简介
本文件为 purelyprofit-server 的完整 API 接口文档，覆盖认证与权限、仪表板、财务、商品、营销、会员、订阅、门店、运营（销售、交接、空间、员工、座位）、通知等模块的 RESTful 接口规范。内容包括：
- HTTP 方法与 URL 模式
- 请求/响应数据模型
- 认证方式与权限控制
- 错误处理策略
- 安全与速率限制建议
- 版本与兼容性说明
- 常见用例、客户端实现指南与性能优化技巧
- 调试与监控方法

**更新** 本次更新重点扩展了空间会话模块的团购平台功能，支持美团、抖音、快手等多个主流团购平台的集成。

## 项目结构
后端基于 NestJS 架构，采用模块化设计，按业务域划分模块（auth、dashboard、finance、goods、marketing、member、subscriptions、stores、operations、staff、notifications 等）。应用入口在主模块中注册各业务模块，并通过全局守卫与装饰器实现鉴权与权限控制。

```mermaid
graph TB
A["应用入口<br/>src/main.ts"] --> B["应用模块<br/>src/app.module.ts"]
B --> C["认证模块<br/>src/purely-profit/auth/*"]
B --> D["仪表板模块<br/>src/purely-profit/dashboard/*"]
B --> E["财务模块<br/>src/purely-profit/finance/*"]
B --> F["商品模块<br/>src/purely-profit/goods/*"]
B --> G["营销模块<br/>src/purely-profit/marketing/*"]
B --> H["会员模块<br/>src/purely-profit/member/*"]
B --> I["订阅模块<br/>src/purely-profit/subscriptions/*"]
B --> J["门店模块<br/>src/purely-profit/stores/*"]
B --> K["运营模块<br/>src/purely-profit/operations/*"]
B --> L["员工模块<br/>src/purely-profit/staff/*"]
B --> M["通知模块<br/>src/purely-profit/notifications/*"]
K --> N["空间会话模块<br/>src/purely-profit/operations/spaces/*"]
N --> O["团购平台支持<br/>space-session.constants.ts"]
```

图表来源
- [src/main.ts](file://src/main.ts)
- [src/app.module.ts](file://src/app.module.ts)
- [src/purely-profit/operations/spaces/dto/space-session.constants.ts](file://src/purely-profit/operations/spaces/dto/space-session.constants.ts)

章节来源
- [src/main.ts](file://src/main.ts)
- [src/app.module.ts](file://src/app.module.ts)

## 核心组件
- 应用入口与模块：负责启动服务、注册业务模块与中间件。
- 认证与权限：基于 JWT 的鉴权守卫与策略，配合权限装饰器与访问控制服务实现细粒度权限校验。
- DTO 层：统一定义请求/响应数据结构，确保接口契约清晰。
- 服务层：封装业务逻辑，提供查询、写入、映射与领域对象转换。
- 控制器层：暴露 RESTful 接口，调用服务层并返回标准化响应。

**更新** 空间会话模块现已支持完整的团购平台集成，包括多平台枚举值、结算渠道管理和平台费用计算。

章节来源
- [src/app.controller.ts](file://src/app.controller.ts)
- [src/purely-profit/auth/auth.controller.ts](file://src/purely-profit/auth/auth.controller.ts)
- [src/purely-profit/access-control/access-control.service.ts](file://src/purely-profit/access-control/access-control.service.ts)

## 架构总览
系统采用分层架构与模块化组织，控制器负责路由与参数解析，服务层承载业务规则，DTO 层保证数据契约，权限守卫与装饰器贯穿请求链路以保障安全。

```mermaid
graph TB
subgraph "客户端"
CLI["浏览器/移动端/第三方客户端"]
end
subgraph "网关/中间件"
MW["NestJS 中间件/拦截器"]
end
subgraph "控制器层"
AC["认证控制器"]
DC["仪表板控制器"]
FC["财务控制器"]
GC["商品控制器"]
MC["营销控制器"]
MeC["会员控制器"]
SC["订阅控制器"]
StC["门店控制器"]
OC["运营控制器"]
EC["员工控制器"]
NC["通知控制器"]
SSC["空间会话控制器"]
end
subgraph "服务层"
AS["认证服务"]
DS["仪表板服务"]
FS["财务服务"]
GS["商品服务"]
MS["营销服务"]
MeS["会员服务"]
SS["订阅服务"]
StS["门店服务"]
OS["运营服务"]
ES["员工服务"]
NS["通知服务"]
SSS["空间会话服务"]
end
subgraph "数据与基础设施"
PRISMA["Prisma ORM"]
REDIS["Redis 缓存"]
GP["团购平台常量<br/>GROUPON_PLATFORM_VALUES"]
end
CLI --> MW --> AC
MW --> DC
MW --> FC
MW --> GC
MW --> MC
MW --> MeC
MW --> SC
MW --> StC
MW --> OC
MW --> EC
MW --> NC
MW --> SSC
AC --> AS
DC --> DS
FC --> FS
GC --> GS
MC --> MS
MeC --> MeS
SC --> SS
StC --> StS
OC --> OS
EC --> ES
NC --> NS
SSC --> SSS
AS --> PRISMA
DS --> PRISMA
FS --> PRISMA
GS --> PRISMA
MS --> PRISMA
MeS --> PRISMA
SS --> PRISMA
StS --> PRISMA
OS --> PRISMA
ES --> PRISMA
NS --> PRISMA
SSS --> PRISMA
AS --> REDIS
DS --> REDIS
FS --> REDIS
GS --> REDIS
MS --> REDIS
MeS --> REDIS
SS --> REDIS
StS --> REDIS
OS --> REDIS
ES --> REDIS
NS --> REDIS
SSS --> GP
```

图表来源
- [src/purely-profit/auth/auth.controller.ts](file://src/purely-profit/auth/auth.controller.ts)
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts)
- [src/purely-profit/finance/finance.controller.ts](file://src/purely-profit/finance/finance.controller.ts)
- [src/purely-profit/goods/products/products.controller.ts](file://src/purely-profit/goods/products/products.controller.ts)
- [src/purely-profit/marketing/marketing.controller.ts](file://src/purely-profit/marketing/marketing.controller.ts)
- [src/purely-profit/member/members/members.controller.ts](file://src/purely-profit/member/members/members.controller.ts)
- [src/purely-profit/subscriptions/subscriptions.controller.ts](file://src/purely-profit/subscriptions/subscriptions.controller.ts)
- [src/purely-profit/stores/stores.controller.ts](file://src/purely-profit/stores/stores.controller.ts)
- [src/purely-profit/operations/sales-record/sales-record.controller.ts](file://src/purely-profit/operations/sales-record/sales-record.controller.ts)
- [src/purely-profit/staff/employees/employees.controller.ts](file://src/purely-profit/staff/employees/employees.controller.ts)
- [src/purely-profit/notifications/notifications.controller.ts](file://src/purely-profit/notifications/notifications.controller.ts)
- [src/purely-profit/operations/spaces/space-sessions.controller.ts](file://src/purely-profit/operations/spaces/space-sessions.controller.ts)
- [src/purely-profit/operations/spaces/dto/space-session.constants.ts](file://src/purely-profit/operations/spaces/dto/space-session.constants.ts)

## 详细组件分析

### 认证与权限
- 鉴权方式：基于 JWT 的 Bearer Token，通过守卫与策略进行校验。
- 权限控制：通过权限装饰器与访问控制服务，结合用户能力集与资源权限进行授权。
- 子账号限制：提供子账号阻断装饰器，防止越权访问。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant AuthCtrl as "认证控制器"
participant AuthService as "认证服务"
participant JwtGuard as "JWT 守卫"
participant JwtStrategy as "JWT 策略"
Client->>AuthCtrl : POST /auth/login
AuthCtrl->>AuthService : 验证凭据
AuthService-->>AuthCtrl : 返回令牌
AuthCtrl-->>Client : {token}
Client->>JwtGuard : 携带 Authorization : Bearer <token>
JwtGuard->>JwtStrategy : 解析与验证令牌
JwtStrategy-->>JwtGuard : 用户标识与权限
JwtGuard-->>Client : 放行或拒绝
```

图表来源
- [src/purely-profit/auth/auth.controller.ts](file://src/purely-profit/auth/auth.controller.ts)
- [src/purely-profit/auth/auth.service.ts](file://src/purely-profit/auth/auth.service.ts)
- [src/purely-profit/auth/guards/jwt-auth.guard.ts](file://src/purely-profit/auth/guards/jwt-auth.guard.ts)
- [src/purely-profit/auth/strategies/jwt.strategy.ts](file://src/purely-profit/auth/strategies/jwt.strategy.ts)

章节来源
- [src/purely-profit/auth/auth.controller.ts](file://src/purely-profit/auth/auth.controller.ts)
- [src/purely-profit/auth/auth.service.ts](file://src/purely-profit/auth/auth.service.ts)
- [src/purely-profit/auth/guards/jwt-auth.guard.ts](file://src/purely-profit/auth/guards/jwt-auth.guard.ts)
- [src/purely-profit/auth/strategies/jwt.strategy.ts](file://src/purely-profit/auth/strategies/jwt.strategy.ts)
- [src/purely-profit/access-control/access-control.service.ts](file://src/purely-profit/access-control/access-control.service.ts)
- [src/purely-profit/access-control/guards/permissions.guard.ts](file://src/purely-profit/access-control/guards/permissions.guard.ts)
- [src/purely-profit/access-control/decorators/require-permissions.decorator.ts](file://src/purely-profit/access-control/decorators/require-permissions.decorator.ts)
- [src/purely-profit/access-control/decorators/block-sub-account.decorator.ts](file://src/purely-profit/access-control/decorators/block-sub-account.decorator.ts)

### 空间会话接口（已更新）
空间会话接口现已全面支持团购平台功能，涵盖开台、续费、结账等核心业务流程。

#### 支持的团购平台
系统支持以下主流团购平台：
- **meituan** - 美团
- **douyin** - 抖音  
- **kuaishou** - 快手
- **xiaohongshu** - 小红书
- **dianping** - 大众点评
- **eleme** - 饿了么
- **pinduoduo** - 拼多多
- **taobao** - 淘宝
- **jd** - 京东
- **wechat_store** - 微信小商店
- **other** - 其他

#### 开台接口增强
开台接口现在支持预付团购券码和平台信息：
- `prepaidGrouponCode` - 预付团购券码
- `prepaidGrouponPlatform` - 预付团购平台
- `prepaidVoucherCode` - 预付券码
- `prepaidVoucherPlatform` - 预付券所属平台
- `prepaidVoucherFaceAmount` - 预付券面金额

#### 结账接口增强
结账接口支持完整的团购平台结算信息：
- `grouponCode` - 团购券码
- `grouponPlatform` - 团购平台
- `customerPaymentMethod` - 顾客实际支付方式（支持 groupon_voucher）
- `settlementChannel` - 平台结算渠道
- `voucherCode` - 券码
- `voucherPlatform` - 券所属平台
- `voucherFaceAmount` - 券面金额
- `settlementStatus` - 平台结算状态
- `platformReceivable` - 平台应收金额
- `platformSettledAmount` - 平台已结金额
- `platformFee` - 平台手续费

#### 续费接口增强
续费接口支持团购券支付：
- `grouponCode` - 团购券码
- `grouponPlatform` - 团购平台
- `voucherFaceAmount` - 券面金额

```mermaid
sequenceDiagram
participant Client as "客户端"
participant SpaceSessionsCtrl as "空间会话控制器"
participant SpaceSessionsService as "空间会话服务"
participant GrouponConstants as "团购平台常量"
Note over Client,GrouponConstants : 开台流程支持预付团购券
Client->>SpaceSessionsCtrl : POST /spaces/ : spaceId/sessions
SpaceSessionsCtrl->>SpaceSessionsService : openSpaceSession()
SpaceSessionsService->>GrouponConstants : 验证团购平台枚举
GrouponConstants-->>SpaceSessionsService : 返回有效平台列表
SpaceSessionsService-->>SpaceSessionsCtrl : 创建会话
SpaceSessionsCtrl-->>Client : 返回会话详情
Note over Client,GrouponConstants : 结账流程支持团购结算
Client->>SpaceSessionsCtrl : POST /space-sessions/ : id/checkout
SpaceSessionsCtrl->>SpaceSessionsService : checkoutSpaceSession()
SpaceSessionsService->>GrouponConstants : 验证结算渠道和平台
GrouponConstants-->>SpaceSessionsService : 返回有效枚举值
SpaceSessionsService-->>SpaceSessionsCtrl : 完成结账
SpaceSessionsCtrl-->>Client : 返回结账结果
```

图表来源
- [src/purely-profit/operations/spaces/space-sessions.controller.ts](file://src/purely-profit/operations/spaces/space-sessions.controller.ts)
- [src/purely-profit/operations/spaces/dto/space-session-checkout.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-checkout.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-open.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-open.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session.constants.ts](file://src/purely-profit/operations/spaces/dto/space-session.constants.ts)

**章节来源**
- [src/purely-profit/operations/spaces/space-sessions.controller.ts](file://src/purely-profit/operations/spaces/space-sessions.controller.ts)
- [src/purely-profit/operations/spaces/dto/space-session-checkout.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-checkout.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-open.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-open.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-preview.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-preview.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-renew.request.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-renew.request.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session-shared.response.dto.ts](file://src/purely-profit/operations/spaces/dto/space-session-shared.response.dto.ts)
- [src/purely-profit/operations/spaces/dto/space-session.constants.ts](file://src/purely-profit/operations/spaces/dto/space-session.constants.ts)

### 仪表板接口
- 仪表板首页：提供概览统计、销售趋势、活动等聚合数据。
- 业务分析：支持多维度分析与筛选。
- 利润明细：提供利润构成与明细查询。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant DHCtrl as "仪表板首页控制器"
participant DHService as "仪表板首页服务"
participant DashBA as "业务分析控制器"
participant DashBAService as "业务分析服务"
participant ProfitDetailCtrl as "利润明细控制器"
participant ProfitDetailService as "利润明细服务"
Client->>DHCtrl : GET /dashboard/home
DHCtrl->>DHService : 组装查询参数
DHService-->>DHCtrl : 返回聚合结果
DHCtrl-->>Client : 仪表板首页数据
Client->>DashBA : GET /dashboard/business-analysis
DashBA->>DashBAService : 执行分析查询
DashBAService-->>DashBA : 返回分析结果
DashBA-->>Client : 分析报表
Client->>ProfitDetailCtrl : GET /dashboard/profit-detail
ProfitDetailCtrl->>ProfitDetailService : 查询利润明细
ProfitDetailService-->>ProfitDetailCtrl : 返回明细数据
ProfitDetailCtrl-->>Client : 利润明细
```

图表来源
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts)
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts)
- [src/purely-profit/dashboard/business-analysis/business-analysis.controller.ts](file://src/purely-profit/dashboard/business-analysis/business-analysis.controller.ts)
- [src/purely-profit/dashboard/business-analysis/business-analysis.service.ts](file://src/purely-profit/dashboard/business-analysis/business-analysis.service.ts)
- [src/purely-profit/dashboard/profit-detail/profit-detail.controller.ts](file://src/purely-profit/dashboard/profit-detail/profit-detail.controller.ts)
- [src/purely-profit/dashboard/profit-detail/profit-detail.service.ts](file://src/purely-profit/dashboard/profit-detail/profit-detail.service.ts)

章节来源
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.controller.ts)
- [src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts](file://src/purely-profit/dashboard/dashboard-home/dashboard-home.service.ts)
- [src/purely-profit/dashboard/business-analysis/business-analysis.controller.ts](file://src/purely-profit/dashboard/business-analysis/business-analysis.controller.ts)
- [src/purely-profit/dashboard/business-analysis/business-analysis.service.ts](file://src/purely-profit/dashboard/business-analysis/business-analysis.service.ts)
- [src/purely-profit/dashboard/profit-detail/profit-detail.controller.ts](file://src/purely-profit/dashboard/profit-detail/profit-detail.controller.ts)
- [src/purely-profit/dashboard/profit-detail/profit-detail.service.ts](file://src/purely-profit/dashboard/profit-detail/profit-detail.service.ts)

### 财务接口
- 账户管理：查询账户列表与详情。
- 现金流：查询现金流明细。
- 对账单：执行对账与查询。
- 概览：提供财务概览报表。
- 报表：导出与查询各类财务报表。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant FinanceCtrl as "财务控制器"
participant FinanceService as "财务服务"
Client->>FinanceCtrl : GET /finance/accounts
Client->>FinanceCtrl : GET /finance/cash-flows
Client->>FinanceCtrl : GET /finance/reconciliations
Client->>FinanceCtrl : GET /finance/overview
Client->>FinanceCtrl : GET /finance/reports
FinanceCtrl->>FinanceService : 解析查询参数
FinanceService-->>FinanceCtrl : 返回财务数据
FinanceCtrl-->>Client : 标准化响应
```

图表来源
- [src/purely-profit/finance/finance.controller.ts](file://src/purely-profit/finance/finance.controller.ts)
- [src/purely-profit/finance/finance.service.ts](file://src/purely-profit/finance/finance.service.ts)

章节来源
- [src/purely-profit/finance/finance.controller.ts](file://src/purely-profit/finance/finance.controller.ts)
- [src/purely-profit/finance/finance.service.ts](file://src/purely-profit/finance/finance.service.ts)
- [src/purely-profit/finance/dto/finance-response.dto.ts](file://src/purely-profit/finance/dto/finance-response.dto.ts)
- [src/purely-profit/finance/dto/finance-query.dto.ts](file://src/purely-profit/finance/dto/finance-query.dto.ts)
- [src/purely-profit/finance/dto/finance-overview.response.dto.ts](file://src/purely-profit/finance/dto/finance-overview.response.dto.ts)
- [src/purely-profit/finance/dto/finance-account.response.dto.ts](file://src/purely-profit/finance/dto/finance-account.response.dto.ts)
- [src/purely-profit/finance/dto/finance-cash-flow.response.dto.ts](file://src/purely-profit/finance/dto/finance-cash-flow.response.dto.ts)
- [src/purely-profit/finance/dto/finance-reconciliation.response.dto.ts](file://src/purely-profit/finance/dto/finance-reconciliation.response.dto.ts)
- [src/purely-profit/finance/dto/finance-report.response.dto.ts](file://src/purely-profit/finance/dto/finance-report.response.dto.ts)
- [src/purely-profit/finance/dto/finance-account.query.dto.ts](file://src/purely-profit/finance/dto/finance-account.query.dto.ts)
- [src/purely-profit/finance/dto/finance-cash-flow.query.dto.ts](file://src/purely-profit/finance/dto/finance-cash-flow.query.dto.ts)
- [src/purely-profit/finance/dto/finance-reconciliation.query.dto.ts](file://src/purely-profit/finance/dto/finance-reconciliation.query.dto.ts)
- [src/purely-profit/finance/dto/finance-overview.query.dto.ts](file://src/purely-profit/finance/dto/finance-overview.query.dto.ts)

### 商品接口
- 商品：查询与管理商品。
- 库存：查询库存与盘点。
- 分类：查询与管理分类。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant ProdCtrl as "商品控制器"
participant InvCtrl as "库存控制器"
participant CatCtrl as "分类控制器"
participant ProdService as "商品服务"
participant InvService as "库存服务"
participant CatService as "分类服务"
Client->>ProdCtrl : GET /goods/products
ProdCtrl->>ProdService : 查询商品
ProdService-->>ProdCtrl : 返回商品列表
ProdCtrl-->>Client : 商品数据
Client->>InvCtrl : GET /goods/inventory
InvCtrl->>InvService : 查询库存
InvService-->>InvCtrl : 返回库存数据
InvCtrl-->>Client : 库存数据
Client->>CatCtrl : GET /goods/categories
CatCtrl->>CatService : 查询分类
CatService-->>CatCtrl : 返回分类数据
CatCtrl-->>Client : 分类数据
```

图表来源
- [src/purely-profit/goods/products/products.controller.ts](file://src/purely-profit/goods/products/products.controller.ts)
- [src/purely-profit/goods/products/products.service.ts](file://src/purely-profit/goods/products/products.service.ts)
- [src/purely-profit/goods/inventory/inventory.controller.ts](file://src/purely-profit/goods/inventory/inventory.controller.ts)
- [src/purely-profit/goods/inventory/inventory.service.ts](file://src/purely-profit/goods/inventory/inventory.service.ts)
- [src/purely-profit/goods/categories/categories.controller.ts](file://src/purely-profit/goods/categories/categories.controller.ts)
- [src/purely-profit/goods/categories/categories.service.ts](file://src/purely-profit/goods/categories/categories.service.ts)

章节来源
- [src/purely-profit/goods/products/products.controller.ts](file://src/purely-profit/goods/products/products.controller.ts)
- [src/purely-profit/goods/products/products.service.ts](file://src/purely-profit/goods/products/products.service.ts)
- [src/purely-profit/goods/inventory/inventory.controller.ts](file://src/purely-profit/goods/inventory/inventory.controller.ts)
- [src/purely-profit/goods/inventory/inventory.service.ts](file://src/purely-profit/goods/inventory/inventory.service.ts)
- [src/purely-profit/goods/categories/categories.controller.ts](file://src/purely-profit/goods/categories/categories.controller.ts)
- [src/purely-profit/goods/categories/categories.service.ts](file://src/purely-profit/goods/categories/categories.service.ts)
- [src/purely-profit/goods/products/dto/products-query.dto.ts](file://src/purely-profit/goods/products/dto/products-query.dto.ts)
- [src/purely-profit/goods/inventory/dto/inventory-query.dto.ts](file://src/purely-profit/goods/inventory/dto/inventory-query.dto.ts)
- [src/purely-profit/goods/categories/dto/categories-query.dto.ts](file://src/purely-profit/goods/categories/dto/categories-query.dto.ts)

### 营销接口
- 营销总览：提供营销指标概览。
- 客户：查询客户与消费记录。
- 商品：查询营销商品。
- 促销：查询促销活动。
- 交易：查询交易流水。
- 积分与充值：查询积分记录与充值记录。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant MKTCtrl as "营销控制器"
participant MKTService as "营销服务"
participant CustCtrl as "客户控制器"
participant ProdCtrl as "商品控制器"
participant PromCtrl as "促销控制器"
participant TransCtrl as "交易控制器"
Client->>MKTCtrl : GET /marketing/overview
MKTCtrl->>MKTService : 获取概览
MKTService-->>MKTCtrl : 返回概览数据
MKTCtrl-->>Client : 概览
Client->>CustCtrl : GET /marketing/customers
Client->>ProdCtrl : GET /marketing/products
Client->>PromCtrl : GET /marketing/promotions
Client->>TransCtrl : GET /marketing/transactions
MKTCtrl->>MKTService : 解析查询参数
MKTService-->>MKTCtrl : 返回营销数据
MKTCtrl-->>Client : 营销数据
```

图表来源
- [src/purely-profit/marketing/marketing.controller.ts](file://src/purely-profit/marketing/marketing.controller.ts)
- [src/purely-profit/marketing/marketing.service.ts](file://src/purely-profit/marketing/marketing.service.ts)
- [src/purely-profit/marketing/marketing-customers.controller.ts](file://src/purely-profit/marketing/marketing-customers.controller.ts)
- [src/purely-profit/marketing/marketing-overview.controller.ts](file://src/purely-profit/marketing/marketing-overview.controller.ts)
- [src/purely-profit/marketing/marketing-products.controller.ts](file://src/purely-profit/marketing/marketing-products.controller.ts)
- [src/purely-profit/marketing/marketing-promotions.controller.ts](file://src/purely-profit/marketing/marketing-promotions.controller.ts)
- [src/purely-profit/marketing/marketing-transactions.controller.ts](file://src/purely-profit/marketing/marketing-transactions.controller.ts)

章节来源
- [src/purely-profit/marketing/marketing.controller.ts](file://src/purely-profit/marketing/marketing.controller.ts)
- [src/purely-profit/marketing/marketing.service.ts](file://src/purely-profit/marketing/marketing.service.ts)
- [src/purely-profit/marketing/dto/marketing-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-pagination-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-pagination-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-consumption-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-consumption-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-customer-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-customer-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-product.dto.ts](file://src/purely-profit/marketing/dto/marketing-product.dto.ts)
- [src/purely-profit/marketing/dto/marketing-promotion-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-promotion-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-recharge-query.dto.ts](file://src/purely-profit/marketing/dto/marketing-recharge-query.dto.ts)
- [src/purely-profit/marketing/dto/marketing-response.dto.ts](file://src/purely-profit/marketing/dto/marketing-response.dto.ts)

### 会员接口
- 会员：查询与管理会员信息。
- 平台会员：查询平台会员配置、订单、合作伙伴、促销等。
- 积分与充值：查询积分记录与充值记录。
- 合伙人审核：审核与查看合作伙伴申请状态。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant MemCtrl as "会员控制器"
participant PMemCtrl as "平台会员控制器"
participant PointsCtrl as "积分记录控制器"
participant RechargeCtrl as "充值记录控制器"
participant PartnerReviewCtrl as "合伙人审核控制器"
Client->>MemCtrl : GET /member/members
Client->>PMemCtrl : GET /member/platform-membership
Client->>PointsCtrl : GET /member/members/points-records
Client->>RechargeCtrl : GET /member/members/recharges
Client->>PartnerReviewCtrl : GET /member/platform-membership/partner-review
MemCtrl-->>Client : 会员数据
PMemCtrl-->>Client : 平台会员数据
PointsCtrl-->>Client : 积分记录
RechargeCtrl-->>Client : 充值记录
PartnerReviewCtrl-->>Client : 审核状态
```

图表来源
- [src/purely-profit/member/members/members.controller.ts](file://src/purely-profit/member/members/members.controller.ts)
- [src/purely-profit/member/members/members.service.ts](file://src/purely-profit/member/members/members.service.ts)
- [src/purely-profit/member/platform-membership/platform-membership.controller.ts](file://src/purely-profit/member/platform-membership/platform-membership.controller.ts)
- [src/purely-profit/member/platform-membership/platform-membership.service.ts](file://src/purely-profit/member/platform-membership/platform-membership.service.ts)
- [src/purely-profit/member/platform-membership/partner-review.controller.ts](file://src/purely-profit/member/platform-membership/partner-review.controller.ts)
- [src/purely-profit/member/platform-membership/promotion-detail-compat.controller.ts](file://src/purely-profit/member/platform-membership/promotion-detail-compat.controller.ts)

章节来源
- [src/purely-profit/member/members/members.controller.ts](file://src/purely-profit/member/members/members.controller.ts)
- [src/purely-profit/member/members/members.service.ts](file://src/purely-profit/member/members/members.service.ts)
- [src/purely-profit/member/platform-membership/platform-membership.controller.ts](file://src/purely-profit/member/platform-membership/platform-membership.controller.ts)
- [src/purely-profit/member/platform-membership/platform-membership.service.ts](file://src/purely-profit/member/platform-membership/platform-membership.service.ts)
- [src/purely-profit/member/platform-membership/partner-review.controller.ts](file://src/purely-profit/member/platform-membership/partner-review.controller.ts)
- [src/purely-profit/member/platform-membership/promotion-detail-compat.controller.ts](file://src/purely-profit/member/platform-membership/promotion-detail-compat.controller.ts)
- [src/purely-profit/member/members/dto/members-query.dto.ts](file://src/purely-profit/member/members/dto/members-query.dto.ts)
- [src/purely-profit/member/members/dto/members-create.dto.ts](file://src/purely-profit/member/members/dto/members-create.dto.ts)
- [src/purely-profit/member/members/dto/members-update.dto.ts](file://src/purely-profit/member/members/dto/members-update.dto.ts)
- [src/purely-profit/member/members/dto/members-response.dto.ts](file://src/purely-profit/member/members/dto/members-response.dto.ts)

### 订阅接口
- 订阅：查询与管理订阅信息。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant SubCtrl as "订阅控制器"
participant SubService as "订阅服务"
Client->>SubCtrl : GET /subscriptions
SubCtrl->>SubService : 解析查询参数
SubService-->>SubCtrl : 返回订阅数据
SubCtrl-->>Client : 订阅信息
```

图表来源
- [src/purely-profit/subscriptions/subscriptions.controller.ts](file://src/purely-profit/subscriptions/subscriptions.controller.ts)
- [src/purely-profit/subscriptions/subscriptions.service.ts](file://src/purely-profit/subscriptions/subscriptions.service.ts)

章节来源
- [src/purely-profit/subscriptions/subscriptions.controller.ts](file://src/purely-profit/subscriptions/subscriptions.controller.ts)
- [src/purely-profit/subscriptions/subscriptions.service.ts](file://src/purely-profit/subscriptions/subscriptions.service.ts)
- [src/purely-profit/subscriptions/dto/subscriptions-query.dto.ts](file://src/purely-profit/subscriptions/dto/subscriptions-query.dto.ts)
- [src/purely-profit/subscriptions/dto/subscriptions-response.dto.ts](file://src/purely-profit/subscriptions/dto/subscriptions-response.dto.ts)

### 门店接口
- 门店：查询与管理门店信息。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant StoreCtrl as "门店控制器"
participant StoreService as "门店服务"
Client->>StoreCtrl : GET /stores
StoreCtrl->>StoreService : 解析查询参数
StoreService-->>StoreCtrl : 返回门店数据
StoreCtrl-->>Client : 门店信息
```

图表来源
- [src/purely-profit/stores/stores.controller.ts](file://src/purely-profit/stores/stores.controller.ts)
- [src/purely-profit/stores/stores.service.ts](file://src/purely-profit/stores/stores.service.ts)

章节来源
- [src/purely-profit/stores/stores.controller.ts](file://src/purely-profit/stores/stores.controller.ts)
- [src/purely-profit/stores/stores.service.ts](file://src/purely-profit/stores/stores.service.ts)
- [src/purely-profit/stores/dto/stores-query.dto.ts](file://src/purely-profit/stores/dto/stores-query.dto.ts)
- [src/purely-profit/stores/dto/stores-response.dto.ts](file://src/purely-profit/stores/dto/stores-response.dto.ts)

### 运营接口
- 销售记录：查询销售明细。
- 交接：查询交接记录与确认。
- 空间：查询空间与预约。
- 员工：查询员工信息。
- 座位：查询座位信息。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant SalesCtrl as "销售记录控制器"
participant HandoverCtrl as "交接控制器"
participant SpacesCtrl as "空间控制器"
participant EmpCtrl as "员工控制器"
participant SeatsCtrl as "座位控制器"
Client->>SalesCtrl : GET /operations/sales-records
Client->>HandoverCtrl : GET /operations/handover
Client->>SpacesCtrl : GET /operations/spaces
Client->>EmpCtrl : GET /staff/employees
Client->>SeatsCtrl : GET /staff/seats
SalesCtrl-->>Client : 销售数据
HandoverCtrl-->>Client : 交接数据
SpacesCtrl-->>Client : 空间数据
EmpCtrl-->>Client : 员工数据
SeatsCtrl-->>Client : 座位数据
```

图表来源
- [src/purely-profit/operations/sales-record/sales-record.controller.ts](file://src/purely-profit/operations/sales-record/sales-record.controller.ts)
- [src/purely-profit/operations/sales-record/sales-record.service.ts](file://src/purely-profit/operations/sales-record/sales-record.service.ts)
- [src/purely-profit/operations/handover/handover.controller.ts](file://src/purely-profit/operations/handover/handover.controller.ts)
- [src/purely-profit/operations/handover/handover.service.ts](file://src/purely-profit/operations/handover/handover.service.ts)
- [src/purely-profit/operations/spaces/spaces.controller.ts](file://src/purely-profit/operations/spaces/spaces.controller.ts)
- [src/purely-profit/operations/spaces/spaces.service.ts](file://src/purely-profit/operations/spaces/spaces.service.ts)
- [src/purely-profit/staff/employees/employees.controller.ts](file://src/purely-profit/staff/employees/employees.controller.ts)
- [src/purely-profit/staff/employees/employees.service.ts](file://src/purely-profit/staff/employees/employees.service.ts)
- [src/purely-profit/staff/seats/seats.controller.ts](file://src/purely-profit/staff/seats/seats.controller.ts)
- [src/purely-profit/staff/seats/seats.service.ts](file://src/purely-profit/staff/seats/seats.service.ts)

章节来源
- [src/purely-profit/operations/sales-record/sales-record.controller.ts](file://src/purely-profit/operations/sales-record/sales-record.controller.ts)
- [src/purely-profit/operations/sales-record/sales-record.service.ts](file://src/purely-profit/operations/sales-record/sales-record.service.ts)
- [src/purely-profit/operations/handover/handover.controller.ts](file://src/purely-profit/operations/handover/handover.controller.ts)
- [src/purely-profit/operations/handover/handover.service.ts](file://src/purely-profit/operations/handover/handover.service.ts)
- [src/purely-profit/operations/spaces/spaces.controller.ts](file://src/purely-profit/operations/spaces/spaces.controller.ts)
- [src/purely-profit/operations/spaces/spaces.service.ts](file://src/purely-profit/operations/spaces/spaces.service.ts)
- [src/purely-profit/staff/employees/employees.controller.ts](file://src/purely-profit/staff/employees/employees.controller.ts)
- [src/purely-profit/staff/employees/employees.service.ts](file://src/purely-profit/staff/employees/employees.service.ts)
- [src/purely-profit/staff/seats/seats.controller.ts](file://src/purely-profit/staff/seats/seats.controller.ts)
- [src/purely-profit/staff/seats/seats.service.ts](file://src/purely-profit/staff/seats/seats.service.ts)
- [src/purely-profit/operations/sales-record/dto/sales-record-query.dto.ts](file://src/purely-profit/operations/sales-record/dto/sales-record-query.dto.ts)
- [src/purely-profit/operations/handover/dto/handover-query.dto.ts](file://src/purely-profit/operations/handover/dto/handover-query.dto.ts)
- [src/purely-profit/operations/spaces/dto/spaces-query.dto.ts](file://src/purely-profit/operations/spaces/dto/spaces-query.dto.ts)
- [src/purely-profit/staff/employees/dto/employees-query.dto.ts](file://src/purely-profit/staff/employees/dto/employees-query.dto.ts)
- [src/purely-profit/staff/seats/dto/seats-query.dto.ts](file://src/purely-profit/staff/seats/dto/seats-query.dto.ts)

### 通知接口
- 通知：查询与标记已读。

```mermaid
sequenceDiagram
participant Client as "客户端"
participant NotiCtrl as "通知控制器"
participant NotiService as "通知服务"
Client->>NotiCtrl : GET /notifications
NotiCtrl->>NotiService : 查询通知
NotiService-->>NotiCtrl : 返回通知列表
NotiCtrl-->>Client : 通知数据
```

图表来源
- [src/purely-profit/notifications/notifications.controller.ts](file://src/purely-profit/notifications/notifications.controller.ts)
- [src/purely-profit/notifications/notifications.service.ts](file://src/purely-profit/notifications/notifications.service.ts)

章节来源
- [src/purely-profit/notifications/notifications.controller.ts](file://src/purely-profit/notifications/notifications.controller.ts)
- [src/purely-profit/notifications/notifications.service.ts](file://src/purely-profit/notifications/notifications.service.ts)
- [src/purely-profit/notifications/dto/notifications.dto.ts](file://src/purely-profit/notifications/dto/notifications.dto.ts)

## 依赖关系分析
- 控制器依赖服务层，服务层依赖领域对象与查询对象。
- 权限装饰器与守卫贯穿控制器，确保访问控制。
- DTO 层作为接口契约，避免控制器直接操作实体。
- 访问控制服务与各模块的访问服务协作，实现细粒度权限。

**更新** 空间会话模块现在依赖团购平台常量定义，确保所有平台相关的枚举值统一管理。

```mermaid
graph LR
AC["认证控制器"] --> AS["认证服务"]
DC["仪表板控制器"] --> DS["仪表板服务"]
FC["财务控制器"] --> FS["财务服务"]
GC["商品控制器"] --> GS["商品服务"]
MC["营销控制器"] --> MS["营销服务"]
MeC["会员控制器"] --> MeS["会员服务"]
SC["订阅控制器"] --> SS["订阅服务"]
StC["门店控制器"] --> StS["门店服务"]
OC["运营控制器"] --> OS["运营服务"]
EC["员工控制器"] --> ES["员工服务"]
NC["通知控制器"] --> NS["通知服务"]
SSC["空间会话控制器"] --> SSS["空间会话服务"]
SSS --> GP["团购平台常量"]
AC --> JwtGuard["JWT 守卫"]
AC --> PermGuard["权限守卫"]
AC --> ACService["访问控制服务"]
DC --> ACService
FC --> ACService
GC --> ACService
MC --> ACService
MeC --> ACService
SC --> ACService
StC --> ACService
OC --> ACService
EC --> ACService
NC --> ACService
SSC --> ACService
```

图表来源
- [src/purely-profit/auth/auth.controller.ts](file://src/purely-profit/auth/auth.controller.ts)
- [src/purely-profit/access-control/access-control.service.ts](file://src/purely-profit/access-control/access-control.service.ts)
- [src/purely-profit/access-control/guards/permissions.guard.ts](file://src/purely-profit/access-control/guards/permissions.guard.ts)
- [src/purely-profit/auth/guards/jwt-auth.guard.ts](file://src/purely-profit/auth/guards/jwt-auth.guard.ts)
- [src/purely-profit/operations/spaces/space-sessions.controller.ts](file://src/purely-profit/operations/spaces/space-sessions.controller.ts)
- [src/purely-profit/operations/spaces/dto/space-session.constants.ts](file://src/purely-profit/operations/spaces/dto/space-session.constants.ts)

章节来源
- [src/purely-profit/access-control/access-control.service.ts](file://src/purely-profit/access-control/access-control.service.ts)
- [src/purely-profit/access-control/guards/permissions.guard.ts](file://src/purely-profit/access-control/guards/permissions.guard.ts)

## 性能考量
- 缓存预热与失效：通过缓存预热服务与键空间管理，减少热点查询延迟。
- 分页与索引：合理使用分页查询与数据库索引，避免大结果集扫描。
- 查询优化：在服务层合并与去重查询，减少 N+1 查询风险。
- 异步处理：对耗时任务采用异步队列或后台作业，避免阻塞请求。
- 监控与告警：结合运行时指标与摘要指标，建立性能基线与异常告警。

**更新** 团购平台常量的集中管理有助于减少重复计算，提升接口响应性能。

## 故障排查指南
- 认证失败：检查令牌格式与有效期，确认 JWT 策略是否正确解析。
- 权限不足：核对用户能力集与资源权限，确认权限装饰器是否生效。
- 查询异常：检查查询 DTO 参数合法性与数据库索引，定位慢查询。
- 缓存问题：确认缓存键命名与失效策略，排查缓存穿透与雪崩。
- 服务异常：查看服务层日志与事务回滚情况，定位业务异常点。
- **团购平台验证失败**：检查传入的平台值是否在 GROUPON_PLATFORM_VALUES 枚举范围内，确认平台名称拼写正确。

## 结论
本接口文档梳理了 purelyprofit-server 的核心 RESTful API，涵盖认证、权限、仪表板、财务、商品、营销、会员、订阅、门店、运营、通知等模块。通过 DTO 契约、权限守卫与访问控制服务，系统实现了高内聚低耦合的接口设计。**本次更新特别增强了空间会话模块的团购平台支持，为多平台团购业务提供了完整的解决方案。** 建议在生产环境中结合缓存、分页、索引与监控体系，持续优化性能与稳定性。

## 附录
- 版本信息：当前仓库包含多个迁移脚本与领域模型，接口版本与迁移脚本保持一致，建议客户端在升级前同步迁移脚本。
- 已弃用功能：部分兼容控制器（如平台会员促销兼容）保留历史接口，建议逐步迁移至新接口。
- 向后兼容性：新增字段采用可选策略，删除字段需通过兼容层或版本化接口过渡。
- **团购平台支持**：新增的团购平台功能完全向后兼容，现有客户端无需修改即可继续使用。

**更新** 团购平台功能的完整支持使得系统能够更好地服务于需要接入美团、抖音、快手等主流团购平台的商业场景。