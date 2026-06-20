import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CommerceModule } from '../../commerce/commerce.module';
import { PrismaModule } from '../../../prisma/prisma.module';
import { SuppliersController } from './suppliers.controller';
import { SuppliersProfileService } from './suppliers-profile.service';
import { SuppliersReadService } from './suppliers-read.service';
import { SuppliersService } from './suppliers.service';
import { SuppliersWriteService } from './suppliers-write.service';

@Module({
  imports: [PrismaModule, CommerceModule, ConfigModule],
  controllers: [SuppliersController],
  providers: [
    SuppliersProfileService,
    SuppliersReadService,
    SuppliersWriteService,
    SuppliersService,
  ],
  exports: [SuppliersService],
})
export class SuppliersModule {}
