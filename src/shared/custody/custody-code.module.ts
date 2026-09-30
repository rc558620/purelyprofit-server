// 客存验证码模块：向 B 端与 C 端客存模块提供统一的 Redis 短码能力
import { Module } from '@nestjs/common';
import { CustodyCodeService } from './custody-code.service';

@Module({
  providers: [CustodyCodeService],
  exports: [CustodyCodeService],
})
export class CustodyCodeModule {}
