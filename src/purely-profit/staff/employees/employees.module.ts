import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { CostsModule } from '../../operations/costs/costs.module';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [AuthModule, CostsModule, PlatformMembershipModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesAccessService],
})
export class EmployeesModule {}
