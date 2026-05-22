import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { MembersAccessService } from './members-access.service';
import {
  MemberPointsController,
  MembersController,
  PartnerBeansController,
} from './members.controller';
import { MembersPointsService } from './members-points.service';
import { MembersService } from './members.service';

@Module({
  imports: [AuthModule],
  controllers: [
    MembersController,
    MemberPointsController,
    PartnerBeansController,
  ],
  providers: [MembersService, MembersAccessService, MembersPointsService],
})
export class MembersModule {}
