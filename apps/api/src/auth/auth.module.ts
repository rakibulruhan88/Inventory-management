import { StaffController } from './staff.controller.js';
import { StaffService } from './staff.service.js';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { sessionJwtOptions } from './session-options.js';
@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [ConfigService],
      useFactory: sessionJwtOptions,
    }),
  ],
  controllers: [AuthController, StaffController],
  providers: [AuthService, StaffService],
  exports: [JwtModule],
})
export class AuthModule {}
