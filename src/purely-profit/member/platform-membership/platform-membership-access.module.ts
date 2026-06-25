import { Module } from '@nestjs/common';
import { PlatformMembershipAccessService } from './platform-membership-access.service';

/**
 * 轻量共享模块，仅提供 PlatformMembershipAccessService。
 *
 * 该 service 只依赖 PrismaService（@Global），不引入任何业务模块，
 * 因此可被 AuthModule 安全导入，切断 AuthModule ↔ PlatformMembershipModule 的循环依赖。
 *
 * 依赖关系：
 *   AuthModule → PlatformMembershipAccessModule（单向）
 *   PlatformMembershipModule → AuthModule + PlatformMembershipAccessModule（单向）
 */
@Module({
  providers: [PlatformMembershipAccessService],
  exports: [PlatformMembershipAccessService],
})
export class PlatformMembershipAccessModule {}
