import type { CreateSaleLine, CreateSaleRequest } from '@afia/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDateString,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { InlinePartyDto } from '../common/inline-party.dto.js';

class CreateSaleLineDto implements CreateSaleLine {
  @IsString() @MinLength(1) variantId: string;
  @IsInt() @Min(1) rollsSold: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) meterSold?: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0.01) lineTotal: number;
}
export class CreateSaleDto implements CreateSaleRequest {
  @IsOptional() @IsString() @MinLength(1) customerId?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => InlinePartyDto)
  customer?: InlinePartyDto;
  @IsDateString() soldAt: string;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) discountAmount: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) receivedAmount: number;
  @IsOptional()
  @IsIn(['CASH', 'BANK', 'MOBILE_BANKING', 'OTHER'])
  paymentMethod?: 'CASH' | 'BANK' | 'MOBILE_BANKING' | 'OTHER';
  @IsOptional() @IsBoolean() emailInvoice?: boolean;
  @IsOptional() @IsString() notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateSaleLineDto)
  lines: CreateSaleLineDto[];
}
