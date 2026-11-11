import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module.js';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { createTypeOrmOptions } from './config/typeorm.config.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { AddressModule } from './modules/identity/users/addresses/address.module.js';
import { CatalogModule } from './modules/catalog/catalog.module.js';
import { CommerceModule } from './modules/commerce/commerce.module.js';
import { AuthCartModule } from './modules/auth-cart/auth-cart.module.js';
import { TransformInterceptor } from './common/interceptors/transform.interceptor.js';
import { HttpExceptionFilter } from './common/filters/http-exception.filter.js';
import { AuctionModule } from './modules/auction/auction.module.js';
import { IntegrationsModule } from './modules/integrations/integrations.module.js';
import { MediaModule } from './modules/media/media.module.js';
import { BullModule } from '@nestjs/bullmq';
import { createBullMqOptions } from './config/bullmq.config.js';
import { ChatModule } from './modules/chat/chat.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createBullMqOptions,
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: createTypeOrmOptions,
    }),
    AddressModule,
    IdentityModule,
    CatalogModule,
    CommerceModule,
    AuthCartModule,
    AuctionModule,
    IntegrationsModule,
    MediaModule,
    AiAssistantModule.register(),
    ChatModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
