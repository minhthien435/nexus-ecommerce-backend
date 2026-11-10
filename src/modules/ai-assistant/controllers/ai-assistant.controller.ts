import {
  AiOptionalAuthGuard,
  type AiHttpRequest,
} from '../services/ai-http-access.guard.js';
import { AiImageService } from '../services/ai-image.service.js';
import {
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  Req,
  UseGuards,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AiProtectionGuard,
  AiOrchestrator,
} from '../ai-orchestrator.contract.js';
import { parseAiChat } from '../dtos/ai-chat.dto.js';

@Controller('api/v1/ai')
@UseGuards(AiOptionalAuthGuard, AiProtectionGuard)
export class AiAssistantController {
  constructor(
    @Inject(AiOrchestrator) private readonly orchestrator: AiOrchestrator,
    @Inject(AiImageService) private readonly images: AiImageService,
  ) {}

  @Post('chat')
  @HttpCode(200)
  async chat(@Body() input: unknown, @Req() request: AiHttpRequest) {
    const dto = parseAiChat(input);
    if (dto.image && !request.user)
      throw new UnauthorizedException({
        errorCode: 'AI_IMAGE_LOGIN_REQUIRED',
        message: 'Vui lòng đăng nhập để tìm bằng ảnh.',
      });
    await this.images.prepare(dto);
    const data = await this.orchestrator.chat(dto, request);
    return { success: true, statusCode: 200, message: 'OK', data };
  }
}
