// src/modules/identity/auth/controllers/auth.controller.ts
import {
  Controller,
  Post,
  Body,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../services/auth.service.js';
import { TokenService } from '../services/token.service.js';
import { RegisterDto } from '../dtos/register.dto.js';
import { LoginDto } from '../dtos/login.dto.js';
import { GoogleLoginDto } from '../dtos/google-login.dto.js';
import { ForgotPasswordDto } from '../dtos/forgot-password.dto.js';
import { VerifyResetOtpDto } from '../dtos/verify-reset-otp.dto.js';
import { ResetPasswordDto } from '../dtos/reset-password.dto.js';
import { RecaptchaService } from '../services/recaptcha.service.js';
import { GoogleIdTokenService } from '../services/google-id-token.service.js';
import { PasswordResetService } from '../services/password-reset.service.js';
import { LoginCartMergeService } from '../../../auth-cart/services/login-cart-merge.service.js';
import { GuestCartInputGuard } from '../guards/guest-cart-input.guard.js';

@Controller('api/v1/auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly tokenService: TokenService,
    private readonly recaptchaService: RecaptchaService,
    private readonly googleIdTokenService: GoogleIdTokenService,
    private readonly passwordResetService: PasswordResetService,
    private readonly loginCartMerge: LoginCartMergeService,
  ) {}

  @Post('register')
  async register(@Body() dto: RegisterDto) {
    const user = await this.authService.register(dto);
    return user;
  }

  @Post('login')
  @UseGuards(GuestCartInputGuard)
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.recaptchaService.verify(dto.captchaToken, req.ip);
    const metadata = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    const { user, accessToken, rawRefreshToken } = await this.authService.login(
      dto,
      metadata,
    );
    this.tokenService.setRefreshTokenCookie(res, rawRefreshToken);

    return {
      accessToken,
      expiresIn: 28_800,
      user,
      ...(dto.guestCartItems === undefined
        ? {}
        : {
            cartMerge: await this.loginCartMerge.merge(
              user.id,
              dto.guestCartItems,
            ),
          }),
    };
  }

  @Post('google')
  @UseGuards(GuestCartInputGuard)
  @HttpCode(HttpStatus.OK)
  async googleLogin(
    @Body() dto: GoogleLoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const identity = await this.googleIdTokenService.verify(dto.credential);
    const { user, accessToken, rawRefreshToken } =
      await this.authService.loginWithGoogle(identity, {
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
    this.tokenService.setRefreshTokenCookie(res, rawRefreshToken);
    return {
      accessToken,
      expiresIn: 28_800,
      user,
      ...(dto.guestCartItems === undefined
        ? {}
        : {
            cartMerge: await this.loginCartMerge.merge(
              user.id,
              dto.guestCartItems,
            ),
          }),
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rawToken = req.cookies?.refreshToken;
    if (!rawToken) {
      throw new UnauthorizedException('Không tìm thấy Refresh Token');
    }

    const metadata = {
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    };

    try {
      const { user, newAccessToken, newRawRefreshToken } =
        await this.tokenService.rotateRefreshToken(rawToken, metadata);

      this.tokenService.setRefreshTokenCookie(res, newRawRefreshToken);

      return {
        accessToken: newAccessToken,
        user: { id: user.id, email: user.email, fullName: user.fullName },
      };
    } catch (err) {
      this.tokenService.clearRefreshTokenCookie(res);
      throw err;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const rawToken = req.cookies?.refreshToken;
    if (rawToken) {
      await this.tokenService.revokeToken(rawToken);
    }
    this.tokenService.clearRefreshTokenCookie(res);

    return null;
  }

  @Post('forgot-password')
  @HttpCode(HttpStatus.OK)
  async forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordResetService.forgotPassword(dto);
  }

  @Post('verify-reset-otp')
  @HttpCode(HttpStatus.OK)
  async verifyResetOtp(@Body() dto: VerifyResetOtpDto) {
    return this.passwordResetService.verifyResetOtp(dto);
  }

  @Post('reset-password')
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() dto: ResetPasswordDto) {
    await this.passwordResetService.resetPassword(dto);
    return null;
  }
}
