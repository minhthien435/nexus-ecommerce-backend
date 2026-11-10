import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AiOrchestrator,
  type AiChatResult,
} from '../ai-orchestrator.contract.js';
import { aiUnavailable } from '../ai-errors.js';
/** Demo fixture only: no Gemini, DB facts, session history or automatic navigation. */
export const AI_DEMO_RESULT: AiChatResult = {
  reply:
    'Đây là dữ liệu mẫu để nối giao diện; trợ lý AI thật chưa được kết nối.',
  products: [],
  action: null,
  suggestions: ['Tìm áo polo dưới 200k'],
};
@Injectable()
export class AiSampleOrchestrator extends AiOrchestrator {
  constructor(@Inject(ConfigService) private readonly config: ConfigService) {
    super();
  }
  async chat(): Promise<AiChatResult> {
    if (
      this.config.get('AI_MOCK_ENABLED') !== 'true' ||
      !['development', 'test'].includes(
        this.config.get<string>('NODE_ENV') ?? '',
      )
    )
      throw aiUnavailable();
    return structuredClone(AI_DEMO_RESULT);
  }
}
