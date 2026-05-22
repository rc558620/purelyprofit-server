import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { CostsController } from './costs.controller';
import { CostsService } from './costs.service';

@Module({
  imports: [CommerceModule],
  controllers: [CostsController],
  providers: [CostsService],
  exports: [CostsService],
})
export class CostsModule {}
