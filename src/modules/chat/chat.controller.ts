import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CurrentUserId } from '../../common/auth/current-user-id.decorator.js';
import { AccessTokenGuard } from '../identity/auth/guards/access-token.guard.js';
import { Roles } from '../identity/rbac/decorators/roles.decorator.js';
import { RolesGuard } from '../identity/rbac/guards/roles.guard.js';
import { ChatService } from './chat.service.js';
import {
  HistoryQueryDto,
  OpenConversationDto,
  SendMessageDto,
} from './dtos/chat.dto.js';

@Controller('api/v1/chat')
@UseGuards(AccessTokenGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}
  @Post('conversations') @UseGuards(RolesGuard) @Roles('BUYER') open(
    @CurrentUserId() id: string,
    @Body() dto: OpenConversationDto,
  ) {
    return this.chat.open(id, dto);
  }
  @Get('conversations') list(@CurrentUserId() id: string) {
    return this.chat.list(id);
  }
  @Get('unread-summary') unread(@CurrentUserId() id: string) {
    return this.chat.unread(id);
  }
  @Get('conversations/:id/messages') history(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Query() query: HistoryQueryDto,
  ) {
    return this.chat.history(userId, id, query);
  }
  @Post('conversations/:id/messages') send(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SendMessageDto,
  ) {
    return this.chat.send(userId, id, dto);
  }
  @Patch('conversations/:id/read') read(
    @CurrentUserId() userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.chat.markRead(userId, id);
  }
}
