import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { ClubStoreAccessService } from './club-store-access.service';
import { ClubInviteAttributionService } from './club-invite-attribution.service';
import { ClubInviteCodeMapService } from './club-invite-code-map.service';
import { ClubMemberBindingService } from './club-member-binding.service';

describe('ClubStoreAccessService', () => {
  let service: ClubStoreAccessService;

  const prismaService = {
    store: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
    member: {
      findFirst: jest.fn(),
    },
  };

  const redisService = {
    getJson: jest.fn(),
    setJson: jest.fn(),
    del: jest.fn(),
  };

  const inviteCodeMapService = {
    findStoreByInviteCode: jest.fn(),
  };

  const inviteAttributionService = {
    logInviteScan: jest.fn(),
    resolveIssueScanAttribution: jest.fn(),
    incrementIssueJoinedCount: jest.fn(),
  };

  const memberBindingService = {
    upsertMemberAndCustomer: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClubStoreAccessService,
        { provide: PrismaService, useValue: prismaService },
        { provide: RedisService, useValue: redisService },
        { provide: ClubInviteCodeMapService, useValue: inviteCodeMapService },
        {
          provide: ClubInviteAttributionService,
          useValue: inviteAttributionService,
        },
        { provide: ClubMemberBindingService, useValue: memberBindingService },
      ],
    }).compile();

    service = module.get(ClubStoreAccessService);
  });

  it('可正常注入依赖', () => {
    expect(service).toBeDefined();
  });
});
