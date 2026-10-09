import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  BadRequestException,
  ValidationPipe,
} from '@nestjs/common';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { permissions, type AuthUser, type Permission } from '@afia/contracts';
import { CurrentUser } from './current-user.decorator.js';
import { StaffService } from './staff.service.js';
export class StaffDto {
  @IsString() @MinLength(1) @MaxLength(100) name: string;
  @IsString()
  @MinLength(3)
  @MaxLength(50)
  @Matches(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/)
  username: string;
  @IsOptional() @IsString() @MinLength(8) @MaxLength(72) password?: string;
  @IsBoolean() isActive: boolean;
  @IsArray()
  @ArrayUnique()
  @IsIn(permissions, { each: true })
  permissions: Permission[];
}
const pipe = new ValidationPipe({
  expectedType: StaffDto,
  transform: true,
  whitelist: true,
  forbidNonWhitelisted: true,
});
@Controller('staff')
export class StaffController {
  constructor(@Inject(StaffService) private readonly staff: StaffService) {}
  @Get() list() {
    return this.staff.list();
  }
  @Get(':id/summary') summary(
    @Param('id') id: string,
    @Query('period') period?: string,
  ) {
    if (period !== undefined && period !== 'all' && period !== 'month')
      throw new BadRequestException('Choose All time or This month.');
    return this.staff.summary(id, period === 'month' ? 'month' : 'all');
  }
  @Post() create(@Body(pipe) input: StaffDto, @CurrentUser() actor: AuthUser) {
    return this.staff.save(undefined, input, actor.id);
  }
  @Patch(':id') update(
    @Param('id') id: string,
    @Body(pipe) input: StaffDto,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.staff.save(id, input, actor.id);
  }
  @Delete(':id') remove(
    @Param('id') id: string,
    @CurrentUser() actor: AuthUser,
  ) {
    return this.staff.remove(id, actor.id);
  }
}
