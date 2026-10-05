import type { StockAdjustmentRequest } from '@afia/contracts';
import { IsInt, IsNumber, IsString, MinLength } from 'class-validator';
export class StockAdjustmentDto implements StockAdjustmentRequest {
  @IsString() @MinLength(1) variantId: string;
  @IsInt() rollsChange: number;
  @IsNumber({ maxDecimalPlaces: 2 }) meterChange: number;
  @IsString() @MinLength(2) reason: string;
}
