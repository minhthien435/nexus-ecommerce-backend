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

export interface AiAssistantRegistration {
  orchestrator: Provider<AiOrchestrator>;
  accessPolicy: Provider<AiAccessPolicy>;
  imports?: ModuleMetadata['imports'];
  providers?: Provider[];
}

/** Deliberately absent from AppModule until Minh's orchestration and protection are ready. */
@Module({})
export class AiAssistantModule {
  static register(options: AiAssistantRegistration): DynamicModule {
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
      imports: [ConfigModule, CatalogModule, ...(options.imports ?? [])],
      controllers: [AiAssistantController],
      providers: [
        AiImageService,
        GeminiClientService,
        { provide: GeminiTransport, useClass: GoogleGeminiTransport },
        SearchProductsTool,
        UiActionHandler,
        ...(options.providers ?? []),
        options.orchestrator,
        options.accessPolicy,
      ],
      exports: [
        GeminiClientService,
        AiImageService,
        SearchProductsTool,
        UiActionHandler,
      ],
    };
  }
}
