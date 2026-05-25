import { Module } from '@nestjs/common';
import { CommerceModule } from '../../commerce/commerce.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { CategoriesController } from './categories.controller';
import { CategoriesReadService } from './categories-read.service';
import { CategoriesService } from './categories.service';
import { CategoriesWriteService } from './categories-write.service';

@Module({
  imports: [PrismaModule, CommerceModule],
  controllers: [CategoriesController],
  providers: [
    CategoriesReadService,
    CategoriesWriteService,
    CategoriesService,
  ],
})
export class CategoriesModule {}
