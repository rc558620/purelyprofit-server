import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { BusinessAnalysisController } from './business-analysis.controller';
import { BusinessAnalysisService } from './business-analysis.service';

@Module({
  imports: [CommerceModule],
  controllers: [BusinessAnalysisController],
  providers: [BusinessAnalysisService],
  exports: [BusinessAnalysisService],
})
export class BusinessAnalysisModule {}
