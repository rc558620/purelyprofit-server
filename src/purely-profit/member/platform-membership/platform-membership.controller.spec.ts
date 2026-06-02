import { GUARDS_METADATA } from '@nestjs/common/constants';
import {
  BLOCK_SUB_ACCOUNT_KEY,
  BLOCK_SUB_ACCOUNT_MESSAGE_KEY,
} from '../../access-control/decorators/block-sub-account.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import {
  PartnerReviewController,
  PlatformMembershipController,
  PromotionDetailCompatController,
} from './platform-membership.controller';

describe('PlatformMembership controllers metadata', () => {
  const cases = [
    PlatformMembershipController,
    PromotionDetailCompatController,
    PartnerReviewController,
  ];

  it.each(cases)('%p 应配置子账号封禁 guard 与文案', (controller) => {
    const guards = Reflect.getMetadata(GUARDS_METADATA, controller) as unknown[];

    expect(guards).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      SubAccountBlockGuard,
    ]);
    expect(Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, controller)).toBe(true);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_MESSAGE_KEY, controller),
    ).toBe('子账号无权访问平台会员中心');
  });
});
