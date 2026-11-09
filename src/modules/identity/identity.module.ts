// src/modules/identity/identity.module.ts
import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { UserEntity } from './domain/user.entity.js';
import { RefreshTokenEntity } from './domain/refresh-token.entity.js';
import { PasswordResetTokenEntity } from './domain/password-reset-token.entity.js';
import { AuditLogEntity } from './domain/audit-log.entity.js';
import { IdentityOutboxEntity } from './domain/identity-outbox.entity.js';

import { AuthService } from './auth/services/auth.service.js';
import { TokenService } from './auth/services/token.service.js';
import { AccessTokenGuard } from './auth/guards/access-token.guard.js';
import { ProfileUserEntity } from './users/entities/profile-user.entity.js';
import { ProfileController } from './users/profile/profile.controller.js';
import { ProfileService } from './users/profile/profile.service.js';
import { PasswordController } from './users/password/password.controller.js';
import { PasswordService } from './users/password/password.service.js';
import { PrivilegeEntity } from './rbac/entities/privilege.entity.js';
import { RolePrivilegeEntity } from './rbac/entities/role-privilege.entity.js';
import { RoleEntity } from './rbac/entities/role.entity.js';
import { UserRoleEntity } from './rbac/entities/user-role.entity.js';
import { PermissionsGuard } from './rbac/guards/permissions.guard.js';
import { RolesGuard } from './rbac/guards/roles.guard.js';
import { RbacService } from './rbac/rbac.service.js';
import { AdminUserController } from './admin/admin-user.controller.js';
import { IdentityAdminUserController } from './admin/identity-admin-user.controller.js';
import { AdminDashboardController } from './admin/admin-dashboard.controller.js';
import { AdminUserService } from './admin/admin-user.service.js';
import { IdentityPublicApi } from './identity-public.api.js';
import { IdentityPublicApiService } from './identity-public-api.service.js';
import { PasswordResetService } from './auth/services/password-reset.service.js';
import { RecaptchaService } from './auth/services/recaptcha.service.js';
import { GoogleIdTokenService } from './auth/services/google-id-token.service.js';
import { EmailModule } from '../../common/email/email.module.js';
import { ShopEntity } from './domain/shop.entity.js';
import { SellerShopController } from './controllers/seller-shop.controller.js';
import { SellerShopService } from './services/seller-shop.service.js';
import { AdminShopController } from './admin/admin-shop.controller.js';
import { AdminShopService } from './admin/admin-shop.service.js';
import { IdentitySupportLookupApi } from './identity-support-lookup.api.js';
import { IdentitySupportLookupService } from './identity-support-lookup.service.js';
import { AddressModule } from './users/addresses/address.module.js';

@Module({
  imports: [
    AddressModule,
    EmailModule,
    TypeOrmModule.forFeature([
      UserEntity,
      RefreshTokenEntity,
      PasswordResetTokenEntity,
      ProfileUserEntity,
      RoleEntity,
      PrivilegeEntity,
      UserRoleEntity,
      RolePrivilegeEntity,
      AuditLogEntity,
      IdentityOutboxEntity,
      ShopEntity,
    ]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET', 'super-secret-key-15m'),
        signOptions: { expiresIn: '8h' },
      }),
    }),
  ],
  controllers: [
    ProfileController,
    PasswordController,
    AdminUserController,
    IdentityAdminUserController,
    AdminDashboardController,
    SellerShopController,
    AdminShopController,
  ],
  providers: [
    AuthService,
    TokenService,
    RecaptchaService,
    GoogleIdTokenService,
    AccessTokenGuard,
    ProfileService,
    PasswordService,
    RbacService,
    RolesGuard,
    PermissionsGuard,
    AdminUserService,
    PasswordResetService,
    SellerShopService,
    AdminShopService,
    {
      provide: IdentityPublicApi,
      useClass: IdentityPublicApiService,
    },
    {
      provide: IdentitySupportLookupApi,
      useClass: IdentitySupportLookupService,
    },
  ],
  exports: [
    AccessTokenGuard,
    JwtModule,
    TypeOrmModule,
    AuthService,
    TokenService,
    RbacService,
    RolesGuard,
    PermissionsGuard,
    IdentityPublicApi,
    IdentitySupportLookupApi,
    PasswordResetService,
    RecaptchaService,
    GoogleIdTokenService,
  ],
})
export class IdentityModule {}
