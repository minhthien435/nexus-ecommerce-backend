import { ConfigModule } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import { AiAssistantModule } from './ai-assistant.module.js';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
} from './contracts/ai-assistant.types.js';
import { AiAgentService } from './services/ai-agent.service.js';
import { AiRateLimitService } from './services/ai-rate-limit.service.js';
import { AiSessionService } from './services/ai-session.service.js';

describe('AiAssistantModule', () => {
  it('compiles and resolves all core services and DI contracts', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        AiAssistantModule,
      ],
    }).compile();

    try {
      expect(moduleRef.get(AiAgentService)).toBeInstanceOf(AiAgentService);
      expect(moduleRef.get(AiSessionService)).toBeInstanceOf(AiSessionService);
      expect(moduleRef.get(AiRateLimitService)).toBeInstanceOf(
        AiRateLimitService,
      );
      expect(moduleRef.get(AiModelClientApi)).toBeDefined();
      expect(moduleRef.get(AiToolExecutorApi)).toBeDefined();
      expect(moduleRef.get(AiUiActionGuardApi)).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});
