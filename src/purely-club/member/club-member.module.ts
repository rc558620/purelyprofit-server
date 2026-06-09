import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PrismaModule } from '../../prisma/prisma.module';
import { ClubStoresModule } from '../stores/club-stores.module';
import { ClubMemberController } from './club-member.controller';
import { ClubMemberService } from './club-member.service';

@Module({
  imports: [AuthModule, PrismaModule, ClubStoresModule],
  controllers: [ClubMemberController],
  providers: [ClubMemberService],
})
export class ClubMemberModule {}
