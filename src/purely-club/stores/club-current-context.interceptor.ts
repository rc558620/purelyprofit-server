import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import type { Observable } from 'rxjs';
import type { AuthenticatedUser } from '../../purely-profit/auth/strategies/jwt.strategy';
import { ClubCurrentStoreContextService } from './club-current-store-context.service';
import type { ClubCurrentContext } from './club-stores.types';

interface ClubContextRequest {
  user?: AuthenticatedUser;
  clubCurrentContext?: ClubCurrentContext;
}

@Injectable()
export class ClubCurrentContextInterceptor implements NestInterceptor {
  constructor(
    private readonly clubCurrentStoreContextService: ClubCurrentStoreContextService,
  ) {}

  async intercept(
    context: ExecutionContext,
    next: CallHandler,
  ): Promise<Observable<unknown>> {
    const request = context.switchToHttp().getRequest<ClubContextRequest>();
    if (request.user && !request.clubCurrentContext) {
      request.clubCurrentContext =
        await this.clubCurrentStoreContextService.resolveCurrentContext(
          request.user,
        );
    }

    return next.handle();
  }
}
