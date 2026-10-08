import {
  IsIn,
  IsISO8601,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Max,
  MaxLength,
} from 'class-validator';
import {
  expenseTypes,
  financeTypes,
  type CreateFinanceEntry,
  type FinanceQuery,
} from '@afia/contracts';
import { LedgerPageDto } from '../sales/ledger-query.dto.js';
export class FinanceQueryDto extends LedgerPageDto implements FinanceQuery {
  @IsOptional() @IsIn(['IN', 'OUT']) direction?: FinanceQuery['direction'];
  @IsOptional()
  @IsIn(['active', 'voided', 'all'])
  status?: FinanceQuery['status'];
  @IsOptional()
  @IsIn(['today', 'yesterday', 'week', 'month', 'specific', 'range'])
  date?: FinanceQuery['date'];
  @IsOptional() @IsString() @MaxLength(10) from?: string;
  @IsOptional() @IsString() @MaxLength(10) to?: string;
  @IsOptional() @IsIn(financeTypes) type?: FinanceQuery['type'];
  @IsOptional()
  @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'])
  method?: FinanceQuery['method'];
  @IsOptional() @IsString() @MaxLength(200) search?: string;
}
export class FinanceEntryDto implements CreateFinanceEntry {
  @IsIn(['OTHER_IN', 'SUPPLIER_PAYMENT', 'EXPENSE', 'OTHER_OUT'])
  type: CreateFinanceEntry['type'];
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive({ message: 'Amount must be more than ৳0.' })
  @Max(999999999999.99)
  amount: number;
  @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'])
  method: CreateFinanceEntry['method'];
  @IsISO8601({ strict: true }) occurredAt: string;
  @IsOptional()
  @IsIn(expenseTypes)
  expenseType?: CreateFinanceEntry['expenseType'];
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsOptional() @IsString() @MaxLength(100) supplierId?: string;
  @IsOptional() @IsString() @MaxLength(100) purchaseId?: string;
  @IsOptional() @IsString() @MaxLength(100) containerId?: string;
  @IsUUID() idempotencyKey: string;
}
export class VoidFinanceDto {
  @IsString() @MaxLength(2000) reason: string;
}
