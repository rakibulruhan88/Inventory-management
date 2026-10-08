import {
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
  Matches,
} from 'class-validator';
import { activityCategories } from '@afia/contracts';
import type { ActivityQuery } from '@afia/contracts';
import { LedgerPageDto } from '../sales/ledger-query.dto.js';
export class ActivityQueryDto extends LedgerPageDto implements ActivityQuery {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(activityCategories) category?: ActivityQuery['category'];
  @IsOptional() @IsString() @MaxLength(100) action?: string;
  @IsOptional() @IsString() @MaxLength(100) actorId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
  @IsOptional() @IsIn(['newest', 'oldest']) sort?: ActivityQuery['sort'];
}
