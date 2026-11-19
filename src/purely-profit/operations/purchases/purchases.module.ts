import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { InventoryModule } from '../../goods/inventory/inventory.module';
import { CostsModule } from '../costs/costs.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { PurchasesController } from './purchases.controller';
import { PurchasesIdempotencyService } from './purchases-idempotency.service';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [PrismaModule, CommerceModule, CostsModule, InventoryModule],
  controllers: [PurchasesController],
  providers: [PurchasesService, PurchasesIdempotencyService],
})
export class PurchasesModule {}
