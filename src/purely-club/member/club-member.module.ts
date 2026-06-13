import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubRecordsModule } from '../records/club-records.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubMemberController } from './club-member.controller';
import { ClubMemberService } from './club-member.service';
import { ClubMemberBenefitsService } from './member-benefits/club-member-benefits.service';
import { ClubMemberLevelsService } from './member-levels/club-member-levels.service';
import { ClubMemberProfileService } from './member-profile/club-member-profile.service';
import { ClubMemberTransactionsService } from './member-transactions/club-member-transactions.service';

@Module({
  imports: [
    forwardRef(() => AuthModule),
    PrismaModule,
    ClubStoresModule,
    ClubRecordsModule,
  ],
  controllers: [ClubMemberController],
  providers: [
    ClubMemberProfileService,
    ClubMemberLevelsService,
    ClubMemberBenefitsService,
    ClubMemberTransactionsService,
    ClubMemberService,
  ],
  exports: [
    ClubMemberService,
    ClubMemberProfileService,
    ClubMemberLevelsService,
  ],
})
export class ClubMemberModule {}
