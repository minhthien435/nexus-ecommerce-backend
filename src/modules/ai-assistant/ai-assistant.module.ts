import { IdentityModule } from '../identity/identity.module.js';
import {
  AiOptionalAuthGuard,
  AiSampleAccessPolicy,
} from './services/ai-http-access.guard.js';
import { AiSampleOrchestrator } from './services/ai-sample-orchestrator.js';
import { TrackMyOrderTool } from './tools/track-my-order.tool.js';
import { ToolExecutorService } from './tools/tool-executor.service.js';
import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from '../catalog/catalog.module.js';
import { AiAccessPolicy, AiOrchestrator } from './ai-orchestrator.contract.js';
import { AiAssistantController } from './controllers/ai-assistant.controller.js';
import { AiImageService } from './services/ai-image.service.js';
import {
  GeminiClientService,
  GeminiTransport,
  GoogleGeminiTransport,
} from './services/gemini-client.service.js';
import { SearchProductsTool } from './tools/search-products.tool.js';
import { UiActionHandler } from './tools/ui-action.handler.js';
import { AiReadTools } from './tools/tool-executor.service.js';
import { AiReadToolsService } from './tools/ai-read-tools.service.js';
import { TrendingProductsQuery } from './queries/trending-products.query.js';
import { AiCacheService } from './services/ai-cache.service.js';

export interface AiAssistantRegistration {
  orchestrator: Provider<AiOrchestrator>;
  accessPolicy: Provider<AiAccessPolicy>;
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
}

/** Default registration exposes only the protected opt-in sample or 503. */
@Module({})
export class AiAssistantModule {
  static register(
    options: AiAssistantRegistration = {
      orchestrator: { provide: AiOrchestrator, useClass: AiSampleOrchestrator },
      accessPolicy: { provide: AiAccessPolicy, useClass: AiSampleAccessPolicy },
    },
  ): DynamicModule {
    for (const [provider, token] of [
      [options.orchestrator, AiOrchestrator],
      [options.accessPolicy, AiAccessPolicy],
    ] as const) {
      if (
        typeof provider !== 'object' ||
        provider === null ||
        !('provide' in provider) ||
        provider.provide !== token
      )
        throw new Error(
          `AI registration requires an explicit ${token.name} provider`,
        );
    }
    return {
      module: AiAssistantModule,
      imports: [
        ConfigModule,
        CatalogModule,
        IdentityModule,
        ...(options.imports ?? []),
      ],
      controllers: [AiAssistantController],
      providers: [
        AiOptionalAuthGuard,
        TrackMyOrderTool,
        ToolExecutorService,
        AiImageService,
        GeminiClientService,
        { provide: GeminiTransport, useClass: GoogleGeminiTransport },
        SearchProductsTool,
        UiActionHandler,
        TrendingProductsQuery,
        AiCacheService,
        AiReadToolsService,
        { provide: AiReadTools, useExisting: AiReadToolsService },
        ...(options.providers ?? []),
        options.orchestrator,
        options.accessPolicy,
      ],
      exports: [
        ToolExecutorService,
        TrackMyOrderTool,
        GeminiClientService,
        AiImageService,
        SearchProductsTool,
        UiActionHandler,
        AiReadTools,
      ],
    };
  }
}
