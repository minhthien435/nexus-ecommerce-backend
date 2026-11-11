import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CategoryService } from '../catalog/services/category.service.js';
import { ProductSearchService } from '../catalog/services/product-search.service.js';
import { IdentityModule } from '../identity/identity.module.js';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { UserEntity } from '../identity/domain/user.entity.js';
import { AiAssistantModule } from './ai-assistant.module.js';
import { AiAccessPolicy, AiOrchestrator } from './ai-orchestrator.contract.js';
import {
  AiModelClientApi,
  AiToolExecutorApi,
  AiUiActionGuardApi,
} from './contracts/ai-assistant.types.js';
import { AiAgentService } from './services/ai-agent.service.js';
import {
  MinhAiAccessPolicy,
  MinhAiOrchestrator,
} from './services/ai-orchestrator.adapters.js';
import { AiRateLimitService } from './services/ai-rate-limit.service.js';
import { AiSessionService } from './services/ai-session.service.js';
import { GeminiClientService } from './services/gemini-client.service.js';
import { ToolExecutorService } from './tools/tool-executor.service.js';
import { UiActionHandler } from './tools/ui-action.handler.js';

@Global()
@Module({
  providers: [{ provide: DataSource, useValue: { query: vi.fn() } }],
  exports: [DataSource],
})
class FakeDatabaseModule {}

@Module({
  providers: [
    { provide: ProductSearchService, useValue: {} },
    { provide: CategoryService, useValue: {} },
  ],
  exports: [ProductSearchService, CategoryService],
})
class FakeCatalogModule {}

@Module({
  providers: [
    AccessTokenGuard,
    { provide: JwtService, useValue: { verifyAsync: vi.fn() } },
    { provide: getRepositoryToken(UserEntity), useValue: { findOne: vi.fn() } },
  ],
  exports: [AccessTokenGuard],
})
class FakeIdentityModule {}

describe('AiAssistantModule.registerAgent', () => {
  it('compiles and resolves live orchestrator, guard policy, agent services, and Hoang tools', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ isGlobal: true, ignoreEnvFile: true }),
        FakeDatabaseModule,
        AiAssistantModule.registerAgent(),
      ],
    })
      .overrideModule(CatalogModule)
      .useModule(FakeCatalogModule)
      .overrideModule(IdentityModule)
      .useModule(FakeIdentityModule)
      .compile();

    try {
      expect(moduleRef.get(AiOrchestrator)).toBeInstanceOf(MinhAiOrchestrator);
      expect(moduleRef.get(AiAccessPolicy)).toBeInstanceOf(MinhAiAccessPolicy);
      expect(moduleRef.get(AiAgentService)).toBeInstanceOf(AiAgentService);
      expect(moduleRef.get(AiSessionService)).toBeInstanceOf(AiSessionService);
      expect(moduleRef.get(AiRateLimitService)).toBeInstanceOf(
        AiRateLimitService,
      );
      expect(moduleRef.get(GeminiClientService)).toBeInstanceOf(
        GeminiClientService,
      );
      expect(moduleRef.get(ToolExecutorService)).toBeInstanceOf(
        ToolExecutorService,
      );
      expect(moduleRef.get(UiActionHandler)).toBeInstanceOf(UiActionHandler);
      expect(moduleRef.get(AiModelClientApi)).toBeDefined();
      expect(moduleRef.get(AiToolExecutorApi)).toBeDefined();
      expect(moduleRef.get(AiUiActionGuardApi)).toBeDefined();
    } finally {
      await moduleRef.close();
    }
  });
});
