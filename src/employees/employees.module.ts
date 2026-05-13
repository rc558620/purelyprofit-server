import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { EmployeesAccessService } from './employees-access.service';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';

@Module({
  imports: [AuthModule],
  controllers: [EmployeesController],
  providers: [EmployeesService, EmployeesAccessService],
})
export class EmployeesModule {}
