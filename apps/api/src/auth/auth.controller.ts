import {
  Body,
  Controller,
  Get,
  Inject,
  Patch,
  Post,
  Res,
} from '@nestjs/common';
import {
  IsEmail,
  IsOptional,
  IsString,
  MinLength,
  ValidateIf,
} from 'class-validator';
import type { Response } from 'express';
import { AuthService } from './auth.service.js';
import { CurrentUser } from './current-user.decorator.js';
import { Public } from './public.decorator.js';
import type { AuthUser } from '@afia/contracts';
class LoginDto {
  @IsString() @MinLength(1) identifier: string;
  @IsString() @MinLength(8) password: string;
}
export class UpdateAccountDto {
  @IsOptional()
  @ValidateIf((_object, value) => value !== '')
  @IsEmail()
  email?: string;
}
export class ChangePasswordDto {
  @IsString() @MinLength(8) currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  @Public() @Post('login') async login(
    @Body() input: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.login(input.identifier, input.password);
    response.cookie('afia_session', result.token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/',
    });
    return { user: result.user };
  }
  @Post('logout') logout(@Res({ passthrough: true }) response: Response) {
    response.clearCookie('afia_session', { path: '/' });
    return { signedOut: true };
  }
  @Get('me') me(@CurrentUser() user: AuthUser) {
    return { user };
  }
  @Get('account') account(@CurrentUser() user: AuthUser) {
    return this.auth.account(user.id);
  }
  @Patch('account') updateAccount(
    @CurrentUser() user: AuthUser,
    @Body() input: UpdateAccountDto,
  ) {
    return this.auth.updateAccount(user.id, input.email);
  }
  @Post('change-password') async changePassword(
    @CurrentUser() user: AuthUser,
    @Body() input: ChangePasswordDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const result = await this.auth.changePassword(
      user.id,
      input.currentPassword,
      input.newPassword,
    );
    response.clearCookie('afia_session', { path: '/' });
    return result;
  }
}
