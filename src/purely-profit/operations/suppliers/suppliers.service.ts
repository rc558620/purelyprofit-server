import { Injectable } from '@nestjs/common';
import type { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import type {
  CreateSupplierDto,
  ListSuppliersQueryDto,
  PaginatedSuppliersResponseDto,
  SupplierResponseDto,
  UpdateSupplierDto,
} from './dto/supplier.dto';
import { SuppliersReadService } from './suppliers-read.service';
import { SuppliersWriteService } from './suppliers-write.service';

@Injectable()
export class SuppliersService {
  constructor(
    private readonly suppliersReadService: SuppliersReadService,
    private readonly suppliersWriteService: SuppliersWriteService,
  ) {}

  list(
    user: AuthenticatedUser,
    query: ListSuppliersQueryDto,
  ): Promise<PaginatedSuppliersResponseDto> {
    return this.suppliersReadService.list(user, query);
  }

  create(
    user: AuthenticatedUser,
    dto: CreateSupplierDto,
  ): Promise<SupplierResponseDto> {
    return this.suppliersWriteService.create(user, dto);
  }

  update(
    user: AuthenticatedUser,
    supplierId: number,
    dto: UpdateSupplierDto,
  ): Promise<SupplierResponseDto> {
    return this.suppliersWriteService.update(user, supplierId, dto);
  }

  remove(user: AuthenticatedUser, supplierId: number): Promise<void> {
    return this.suppliersWriteService.remove(user, supplierId);
  }
}
