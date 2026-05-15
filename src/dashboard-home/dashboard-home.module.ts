import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module';
import { DashboardHomeController } from './dashboard-home.controller';
import { DashboardHomeService } from './dashboard-home.service';

@Module({
  imports: [CommerceModule],
  controllers: [DashboardHomeController],
  providers: [DashboardHomeService],
})
export class DashboardHomeModule {}
