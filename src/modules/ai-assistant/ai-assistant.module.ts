import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
} from './contracts/ai-assistant.types.js';
import { AiAgentService } from './services/ai-agent.service.js';
import {
  DefaultAiUiActionGuard,
  PlaceholderAiModelClient,
  PlaceholderAiToolExecutor,
} from './services/ai-fallback.adapters.js';
import { AiRateLimitService } from './services/ai-rate-limit.service.js';
import { AiSessionService } from './services/ai-session.service.js';

@Module({
  imports: [ConfigModule],
  providers: [
    AiSessionService,
    AiRateLimitService,
    AiAgentService,
    // TODO(BE-11 / Hoang): Replace PlaceholderAiModelClient with GeminiClientService adapter
    {
      provide: AiModelClientApi,
      useClass: PlaceholderAiModelClient,
    },
    // TODO(BE-08..BE-13 / Khoa & Hoang): Replace PlaceholderAiToolExecutor with ToolExecutorService
    {
      provide: AiToolExecutorApi,
      useClass: PlaceholderAiToolExecutor,
    },
    {
      provide: AiUiActionGuardApi,
      useClass: DefaultAiUiActionGuard,
    },
  ],
  exports: [
    AiAgentService,
    AiSessionService,
    AiRateLimitService,
    AiModelClientApi,
    AiToolExecutorApi,
    AiUiActionGuardApi,
  ],
})
export class AiAssistantModule {}
