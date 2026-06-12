import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../../prisma/prisma.service';
import { AccessControlService } from '../access-control.service';
import {
  ALLOW_LEGACY_OWNER_ACCESS_KEY,
  REQUIRE_PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';
import { PermissionsGuard } from './permissions.guard';

describe('PermissionsGuard', () => {
  let guard: PermissionsGuard;

  const reflector = {
    getAllAndOverride: jest.fn(),
  };
  const accessControlService = {
    hasAnyPermission: jest.fn(),
  };
  const prismaService = {
    store: {
      findFirst: jest.fn(),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    reflector.getAllAndOverride.mockImplementation((metadataKey: string) => {
      if (metadataKey === REQUIRE_PERMISSIONS_KEY) {
        return ['marketing:view'];
      }
      if (metadataKey === ALLOW_LEGACY_OWNER_ACCESS_KEY) {
        return false;
      }
      return undefined;
    });
    accessControlService.hasAnyPermission.mockReturnValue(true);
    prismaService.store.findFirst.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PermissionsGuard,
        { provide: Reflector, useValue: reflector },
        { provide: AccessControlService, useValue: accessControlService },
        { provide: PrismaService, useValue: prismaService },
      ],
    }).compile();

    guard = module.get<PermissionsGuard>(PermissionsGuard);
  });

  it('存在激活 membership 且拥有权限时放行', async () => {
    const context = createExecutionContext({
      user: {
        id: 1,
        currentMembership: {
          permissions: ['marketing:view'],
          isActive: true,
          storeId: 18,
        },
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(accessControlService.hasAnyPermission).toHaveBeenCalledWith(
      ['marketing:view'],
      ['marketing:view'],
    );
  });

  it('marketing 控制器开启兼容时允许老 owner 无 membership 放行', async () => {
    reflector.getAllAndOverride.mockImplementation((metadataKey: string) => {
      if (metadataKey === REQUIRE_PERMISSIONS_KEY) {
        return ['marketing:view'];
      }
      if (metadataKey === ALLOW_LEGACY_OWNER_ACCESS_KEY) {
        return true;
      }
      return undefined;
    });
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });

    const context = createExecutionContext({
      user: {
        id: 9,
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(prismaService.store.findFirst).toHaveBeenCalledWith({
      where: { ownerId: 9 },
      select: { id: true },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    });
    expect(accessControlService.hasAnyPermission).not.toHaveBeenCalled();
  });

  it('marketing 控制器开启兼容时允许同店 legacy owner 绕过权限预检', async () => {
    reflector.getAllAndOverride.mockImplementation((metadataKey: string) => {
      if (metadataKey === REQUIRE_PERMISSIONS_KEY) {
        return ['marketing:view'];
      }
      if (metadataKey === ALLOW_LEGACY_OWNER_ACCESS_KEY) {
        return true;
      }
      return undefined;
    });
    accessControlService.hasAnyPermission.mockReturnValue(false);
    prismaService.store.findFirst.mockResolvedValue({ id: 18 });

    const context = createExecutionContext({
      user: {
        id: 9,
        currentMembership: {
          permissions: ['goods:view'],
          isActive: true,
          storeId: 18,
        },
      },
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('非 marketing 兼容接口在无 membership 时仍拒绝访问', async () => {
    const context = createExecutionContext({
      user: {
        id: 9,
      },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('开启兼容但无 owner 门店时仍拒绝访问', async () => {
    reflector.getAllAndOverride.mockImplementation((metadataKey: string) => {
      if (metadataKey === REQUIRE_PERMISSIONS_KEY) {
        return ['marketing:view'];
      }
      if (metadataKey === ALLOW_LEGACY_OWNER_ACCESS_KEY) {
        return true;
      }
      return undefined;
    });

    const context = createExecutionContext({
      user: {
        id: 9,
      },
    });

    await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});

function createExecutionContext(request: {
  user?: {
    id?: number;
    currentMembership?: {
      permissions: string[];
      isActive: boolean;
      storeId?: number;
    };
  };
}) {
  return {
    getHandler: jest.fn(),
    getClass: jest.fn(),
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as never;
}
