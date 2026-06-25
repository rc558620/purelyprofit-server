import { Module } from '@nestjs/common';
import { HandoverPageShiftRecordService } from './handover-page-shift-record.service';

/**
 * 轻量共享模块，仅提供 HandoverPageShiftRecordService。
 *
 * 该 service 只依赖 PrismaService（@Global），不引入任何业务模块，
 * 因此可被 SalesRecordModule 安全导入，切断
 * SalesRecordModule → HandoverModule → SpacesModule → SalesRecordModule 的循环依赖。
 *
 * 依赖关系（去环后）：
 *   SalesRecordModule → HandoverShiftModule（单向）
 *   SpacesModule      → SalesRecordModule（单向）
 *   HandoverModule    → HandoverShiftModule + SpacesModule（单向）
 */
@Module({
  providers: [HandoverPageShiftRecordService],
  exports: [HandoverPageShiftRecordService],
})
export class HandoverShiftModule {}
