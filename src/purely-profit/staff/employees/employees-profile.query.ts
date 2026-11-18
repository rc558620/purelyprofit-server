import type { Employee, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

type PrismaClientOrTransaction = PrismaService | Prisma.TransactionClient;

export function createEmployeeProfile(
  prisma: PrismaClientOrTransaction,
  data: Prisma.EmployeeUncheckedCreateInput,
): Promise<Employee> {
  return prisma.employee.create({ data });
}

export function updateEmployeeProfile(
  prisma: PrismaClientOrTransaction,
  employeeId: number,
  data: Prisma.EmployeeUncheckedUpdateInput,
): Promise<Employee> {
  return prisma.employee.update({
    where: { id: employeeId },
    data,
  });
}
