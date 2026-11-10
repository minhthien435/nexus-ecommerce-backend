import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  AiProtectionGuard,
  AiOrchestrator,
} from '../ai-orchestrator.contract.js';
import { parseAiChat } from '../dtos/ai-chat.dto.js';

@Controller('api/v1/ai')
@UseGuards(AiProtectionGuard)
export class AiAssistantController {
  constructor(
    @Inject(AiOrchestrator) private readonly orchestrator: AiOrchestrator,
  ) {}

  @Post('chat')
  @HttpCode(200)
  chat(@Body() input: unknown, @Req() request: unknown) {
    return this.orchestrator.chat(parseAiChat(input), request);
  }
}
