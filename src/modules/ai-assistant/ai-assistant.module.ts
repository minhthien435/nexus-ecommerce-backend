import {
  Module,
  type DynamicModule,
  type ModuleMetadata,
  type Provider,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from '../catalog/catalog.module.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AiAccessPolicy, AiOrchestrator } from './ai-orchestrator.contract.js';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
} from './contracts/ai-assistant.types.js';
import { AiAssistantController } from './controllers/ai-assistant.controller.js';
import { AiAgentService } from './services/ai-agent.service.js';
import {
  AiOptionalAuthGuard,
  AiSampleAccessPolicy,
} from './services/ai-http-access.guard.js';
import { AiImageService } from './services/ai-image.service.js';
import {
  AiRequestContextService,
  GeminiClientAdapter,
  MinhAiAccessPolicy,
  MinhAiOrchestrator,
  ToolExecutorAdapter,
  UiActionGuardAdapter,
} from './services/ai-orchestrator.adapters.js';
import { AiRateLimitService } from './services/ai-rate-limit.service.js';
import { AiSampleOrchestrator } from './services/ai-sample-orchestrator.js';
import { AiSessionService } from './services/ai-session.service.js';
import { AiCacheService } from './services/ai-cache.service.js';
import { TrendingProductsQuery } from './queries/trending-products.query.js';
import {
  GeminiClientService,
  GeminiTransport,
  GoogleGeminiTransport,
} from './services/gemini-client.service.js';
import { SearchProductsTool } from './tools/search-products.tool.js';
import { AuctionReadToolsService } from './tools/auction-read-tools.service.js';
import { FlashDealReadToolsService } from './tools/flash-deal-read-tools.service.js';
import {
  AiReadTools,
  ToolExecutorService,
} from './tools/tool-executor.service.js';
import { AiReadToolsService } from './tools/ai-read-tools.service.js';
import { TrackMyOrderTool } from './tools/track-my-order.tool.js';
import { UiActionHandler } from './tools/ui-action.handler.js';

export interface AiAssistantRegistration {
  orchestrator: Provider<AiOrchestrator>;
  accessPolicy: Provider<AiAccessPolicy>;
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
  exports?: ModuleMetadata['exports'];
}

/**
 * AI Assistant module supporting both standalone/sample verification (`register()`)
 * and full live agent orchestration (`registerAgent()`).
 */
@Module({})
export class AiAssistantModule {
  /** Default registration exposes only the protected opt-in sample or 503. */
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
        AuctionReadToolsService,
        FlashDealReadToolsService,
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
        AuctionReadToolsService,
        FlashDealReadToolsService,
        UiActionHandler,
        AiReadTools,
        ...(options.exports ?? []),
      ],
    };
  }

  /** Production wiring combining Minh's Agent/Session/RateLimit with Hoang's Gemini/Tools/Guards. */
  static registerAgent(): DynamicModule {
    return AiAssistantModule.register({
      orchestrator: { provide: AiOrchestrator, useClass: MinhAiOrchestrator },
      accessPolicy: { provide: AiAccessPolicy, useClass: MinhAiAccessPolicy },
      providers: [
        AiRequestContextService,
        AiSessionService,
        AiRateLimitService,
        AiAgentService,
        { provide: AiModelClientApi, useClass: GeminiClientAdapter },
        { provide: AiToolExecutorApi, useClass: ToolExecutorAdapter },
        { provide: AiUiActionGuardApi, useClass: UiActionGuardAdapter },
      ],
      exports: [
        AiOrchestrator,
        AiAccessPolicy,
        AiAgentService,
        AiSessionService,
        AiRateLimitService,
        AiModelClientApi,
        AiToolExecutorApi,
        AiUiActionGuardApi,
      ],
    });
  }
}
