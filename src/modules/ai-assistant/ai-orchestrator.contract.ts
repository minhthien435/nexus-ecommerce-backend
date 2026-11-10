import {
  Inject,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { AiChatDto } from './dtos/ai-chat.dto.js';
import type { AiProduct } from './tools/search-products.tool.js';
import type { UiAction } from './tools/ui-action.handler.js';

export type AiChatResult = {
  sessionId: string;
  reply: string;
  products: AiProduct[];
  action: UiAction | null;
  suggestions: string[];
};

/** Minh supplies authenticated identity, rate limiting and session ownership enforcement. */
export abstract class AiAccessPolicy implements CanActivate {
  abstract canActivate: CanActivate['canActivate'];
}

export abstract class AiOrchestrator {
  abstract chat(input: AiChatDto, request: unknown): Promise<AiChatResult>;
}

@Injectable()
export class AiProtectionGuard implements CanActivate {
  constructor(
    @Inject(AiAccessPolicy) private readonly policy: AiAccessPolicy,
  ) {}
  canActivate(context: ExecutionContext) {
    return this.policy.canActivate(context);
  }
}
