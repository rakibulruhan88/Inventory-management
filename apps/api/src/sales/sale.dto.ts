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
  Max,
  MinLength,
  ValidateNested,
  ValidateIf,
} from 'class-validator';
import { InlinePartyDto } from '../common/inline-party.dto.js';

class CreateSaleLineDto implements CreateSaleLine {
  @IsString() @MinLength(1) variantId: string;
  @IsOptional() @IsIn(['FULL_ROLL', 'BY_METER']) mode?: 'FULL_ROLL' | 'BY_METER';
  @IsInt() @Min(0) @Max(2147483647) rollsSold: number;
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(9999999999.99)
  meterSold?: number;
  @ValidateIf((line: CreateSaleLineDto) => line.mode !== 'BY_METER' || line.unitPricePerRoll !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(999999999999.99)
  unitPricePerRoll?: number;
  @ValidateIf((line: CreateSaleLineDto) => line.mode === 'BY_METER' || line.unitPricePerMeter !== undefined)
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0.01)
  @Max(9999999999.99)
  unitPricePerMeter?: number;
  // Accepted for older clients that also send a preview, but never used for pricing.
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) lineTotal?: number;
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
