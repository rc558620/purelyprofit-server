import { Module } from '@nestjs/common';
import { AccessControlModule } from '../access-control/access-control.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { CommerceAccessService } from './commerce-access.service';

@Module({
  imports: [PrismaModule, AccessControlModule],
  providers: [CommerceAccessService],
  exports: [CommerceAccessService],
})
export class CommerceModule {}
