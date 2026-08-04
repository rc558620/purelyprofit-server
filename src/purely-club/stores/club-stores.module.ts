import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { StoresModule } from '../../purely-profit/stores/stores.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubCurrentContextInterceptor } from './club-current-context.interceptor';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubStoreViewService } from './club-store-view.service';
import { ClubInviteEntryController } from './club-invite-entry.controller';
import { ClubStoresController } from './club-stores.controller';
import { ClubStoresService } from './club-stores.service';

@Module({
  imports: [AuthModule, PrismaModule, StoresModule],
  controllers: [ClubStoresController, ClubInviteEntryController],
  providers: [
    ClubStoreAccessService,
    ClubCurrentContextInterceptor,
    ClubCurrentStoreContextService,
    ClubStoreViewService,
    ClubStoresService,
  ],
  exports: [
    ClubStoreAccessService,
    ClubCurrentContextInterceptor,
    ClubCurrentStoreContextService,
    ClubStoreViewService,
    ClubStoresService,
  ],
})
export class ClubStoresModule {}
