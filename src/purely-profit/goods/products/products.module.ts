import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, CommerceModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
