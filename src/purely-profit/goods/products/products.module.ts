import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [PrismaModule, CommerceModule, PlatformMembershipModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
