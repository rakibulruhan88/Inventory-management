import { Type } from 'class-transformer';
import {
  IsNumber,
  IsPositive,
  Max,
  IsString,
  IsOptional,
  MaxLength,
  IsUUID,
  Matches,
  IsDateString,
  ValidateNested,
} from 'class-validator';
import { CustomerDto } from './customer.dto.js';
export class OpeningDueDto {
  @IsNumber({ maxDecimalPlaces: 2 }, { message: 'Enter a valid Opening Due.' })
  @IsPositive({ message: 'Opening Due must be more than ৳0.' })
  @Max(999999999999.99)
  amount: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Choose a valid Balance Date.' })
  @IsDateString({ strict: true }, { message: 'Choose a valid Balance Date.' })
  balanceAsOf: string;
  @IsOptional() @IsString() @MaxLength(2000) note?: string;
  @IsUUID(undefined, { message: 'Please retry saving the Opening Due.' })
  idempotencyKey: string;
}
export class CustomerWithOpeningDueDto extends CustomerDto {
  @ValidateNested() @Type(() => OpeningDueDto) openingDue: OpeningDueDto;
}
