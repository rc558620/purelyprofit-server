import { Module } from '@nestjs/common';
import { AuthModule } from '../../purely-profit/auth/auth.module';
import { PulseAuthController } from './pulse-auth.controller';
import { PulseAuthService } from './pulse-auth.service';

@Module({
  imports: [AuthModule],
  controllers: [PulseAuthController],
  providers: [PulseAuthService],
})
export class PulseAuthModule {}
