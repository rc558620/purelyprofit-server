import type { Employee, Prisma } from '@prisma/client';
import type { PrismaService } from '../../../prisma/prisma.service';

export async function queryLatestEmployeeProfileEmpNo(
  prisma: PrismaService,
  storeId: number,
): Promise<string | null> {
  const latestEmployee = await prisma.employee.findFirst({
    where: { storeId },
    orderBy: { id: 'desc' },
    select: { empNo: true },
  });

  return latestEmployee?.empNo ?? null;
}

export function createEmployeeProfile(
  prisma: PrismaService,
  data: Prisma.EmployeeUncheckedCreateInput,
): Promise<Employee> {
  return prisma.employee.create({ data });
}

export function updateEmployeeProfile(
  prisma: PrismaService,
  employeeId: number,
  data: Prisma.EmployeeUncheckedUpdateInput,
): Promise<Employee> {
  return prisma.employee.update({
    where: { id: employeeId },
    data,
  });
}
