import {
  customerPhoneError,
  CUSTOMER_PHONE_ERROR,
  type CustomerInput,
} from '@afia/contracts';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
  ValidateBy,
} from 'class-validator';
export class CustomerDto implements CustomerInput {
  @IsString() @MinLength(1) name: string;
  @IsOptional()
  @IsString()
  @ValidateBy({
    name: 'customerPhone',
    validator: {
      validate: (value) => customerPhoneError(value) === null,
      defaultMessage: () => CUSTOMER_PHONE_ERROR,
    },
  })
  phone?: string;
  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  email?: string;
  @IsOptional() @IsString() address?: string;
}
