// 提现模块路由收敛回归用例：禁止再出现第二套未纳管的可写资金入口
import { GUARDS_METADATA, MODULE_METADATA } from '@nestjs/common/constants';
import {
  BLOCK_SUB_ACCOUNT_KEY,
  BLOCK_SUB_ACCOUNT_MESSAGE_KEY,
} from '../../access-control/decorators/block-sub-account.decorator';
import { PermissionsGuard } from '../../access-control/guards/permissions.guard';
import { SubAccountBlockGuard } from '../../access-control/guards/sub-account-block.guard';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { WithdrawalsController } from './withdrawals.controller';
import { WithdrawalsModule } from './withdrawals.module';

describe('WithdrawalsModule 路由收敛', () => {
  it('只注册 withdrawals 一个 controller', () => {
    const controllers = Reflect.getMetadata(
      MODULE_METADATA.CONTROLLERS,
      WithdrawalsModule,
    ) as unknown[];

    expect(controllers).toEqual([WithdrawalsController]);
  });

  it('类级统一挂子账号封禁 Guard，读写接口权限口径一致', () => {
    const guards = Reflect.getMetadata(
      GUARDS_METADATA,
      WithdrawalsController,
    ) as unknown[];

    expect(guards).toEqual([
      JwtAuthGuard,
      PermissionsGuard,
      SubAccountBlockGuard,
    ]);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_KEY, WithdrawalsController),
    ).toBe(true);
    expect(
      Reflect.getMetadata(BLOCK_SUB_ACCOUNT_MESSAGE_KEY, WithdrawalsController),
    ).toBe('子账号无权操作提现');
  });
});
