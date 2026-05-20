import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { ProfitDetailController } from './profit-detail.controller';
import { ProfitDetailService } from './profit-detail.service';

@Module({
  imports: [CommerceModule],
  controllers: [ProfitDetailController],
  providers: [ProfitDetailService],
})
export class ProfitDetailModule {}
