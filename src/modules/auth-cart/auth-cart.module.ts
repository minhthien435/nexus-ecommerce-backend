import { Module } from '@nestjs/common';
import { CommerceModule } from '../commerce/commerce.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AuthController } from '../identity/auth/controllers/auth.controller.js';
import { LoginCartMergeService } from './services/login-cart-merge.service.js';

@Module({
  imports: [IdentityModule, CommerceModule],
  controllers: [AuthController],
  providers: [LoginCartMergeService],
})
export class AuthCartModule {}
