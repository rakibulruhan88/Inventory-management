import type {
  ReceivePurchaseItem,
  ReceivePurchaseColor,
  ReceivePurchaseRequest,
} from '@afia/contracts';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { InlinePartyDto } from '../../common/inline-party.dto.js';

export class ReceivePurchaseColorDto implements ReceivePurchaseColor {
  @IsString() @MinLength(1) color: string;
  @IsInt() @Min(1) rolls: number;
  @IsOptional() @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) totalMeter?: number;
}

export class ReceivePurchaseItemDto implements ReceivePurchaseItem {
  @IsString() @MinLength(1) itemCode: string;
  @IsOptional() @IsString() description?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseColorDto)
  colors: ReceivePurchaseColorDto[];
}

export class ReceivePurchaseDto implements ReceivePurchaseRequest {
  @IsString() @MinLength(1) purchaseNumber: string;
  @IsOptional() @IsString() @MinLength(1) supplierId?: string;
  @IsOptional()
  @ValidateNested()
  @Type(() => InlinePartyDto)
  supplier?: InlinePartyDto;
  @IsString() @MinLength(1) containerNumber: string;
  @IsDateString() purchasedAt: string;
  @IsOptional() @IsString() notes?: string;
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ReceivePurchaseItemDto)
  items: ReceivePurchaseItemDto[];
}
