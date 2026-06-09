import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { ClubAuthController } from './club-auth.controller';
import { ClubAuthService } from './club-auth.service';

@Module({
  imports: [AuthModule],
  controllers: [ClubAuthController],
  providers: [ClubAuthService],
})
export class ClubAuthModule {}
