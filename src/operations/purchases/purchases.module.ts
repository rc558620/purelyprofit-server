import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { CostsModule } from '../costs/costs.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [PrismaModule, CommerceModule, CostsModule],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
