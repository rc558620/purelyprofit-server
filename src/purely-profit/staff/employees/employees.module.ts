import { Module } from '@nestjs/common';
import { AuthModule } from '../../auth/auth.module';
import { PlatformMembershipModule } from '../../member/platform-membership/platform-membership.module';
import { CostsModule } from '../../operations/costs/costs.module';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesController } from './employees.controller';
import { EmployeesDictionaryService } from './employees-dictionary.service';
import { EmployeesLeaveService } from './employees-leave.service';
import { EmployeesPayrollService } from './employees-payroll.service';
import { EmployeesProfileReadService } from './employees-profile-read.service';
import { EmployeesProfileWriteService } from './employees-profile-write.service';
import { EmployeesService } from './employees.service';
import { EmployeesShiftDefinitionService } from './employees-shift-definition.service';
import { EmployeesShiftService } from './employees-shift.service';

@Module({
  imports: [AuthModule, CostsModule, PlatformMembershipModule],
  controllers: [EmployeesController],
  providers: [
    EmployeesService,
    EmployeesAccessService,
    EmployeesProfileReadService,
    EmployeesProfileWriteService,
    EmployeesDictionaryService,
    EmployeesLeaveService,
    EmployeesShiftDefinitionService,
    EmployeesShiftService,
    EmployeesPayrollService,
  ],
})
export class EmployeesModule {}
