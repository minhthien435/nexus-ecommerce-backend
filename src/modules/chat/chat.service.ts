import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Brackets,
  DataSource,
  IsNull,
  LessThanOrEqual,
  Repository,
} from 'typeorm';
import { randomUUID } from 'node:crypto';
import { isUUID } from 'class-validator';
import { ShopEntity } from '../identity/domain/shop.entity.js';
import {
  ProductEntity,
  ProductStatus,
} from '../catalog/domain/entities/product.entity.js';
import { ProductImageEntity } from '../catalog/domain/entities/product-image.entity.js';
import { ProductSkuEntity } from '../catalog/domain/entities/product-sku.entity.js';
import { OrderEntity } from '../commerce/domain/entities/order.entity.js';
import { ChatConversationEntity } from './domain/entities/chat-conversation.entity.js';
import { ChatMessageEntity } from './domain/entities/chat-message.entity.js';
import type {
  HistoryQueryDto,
  OpenConversationDto,
  SendMessageDto,
} from './dtos/chat.dto.js';
import {
  ALLOWED_IMAGE_MIME_TYPES,
  MAX_IMAGE_FILE_SIZE,
} from '../media/media.service.js';
import { ChatEventsService } from './ws/chat-events.service.js';

@Injectable()
export class ChatService {
  private readonly storagePrefix: string;
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(ChatConversationEntity)
    private readonly conversations: Repository<ChatConversationEntity>,
    @InjectRepository(ChatMessageEntity)
    private readonly messages: Repository<ChatMessageEntity>,
    private readonly config: ConfigService,
    private readonly events: ChatEventsService,
  ) {
    const base = (config.get<string>('SUPABASE_URL') ?? '').replace(/\/+$/, '');
    const bucket =
      config.get<string>('SUPABASE_STORAGE_BUCKET') ?? 'nexus-media';
    this.storagePrefix = `${base}/storage/v1/object/public/${bucket}/`;
  }

  private member(
    conversation: ChatConversationEntity,
    userId: string,
  ): 'BUYER' | 'SELLER' {
    if (conversation.buyerId === userId) return 'BUYER';
    if (conversation.sellerId === userId) return 'SELLER';
    throw new NotFoundException('Conversation not found');
  }

  private async conversationFor(
    userId: string,
    id: string,
  ): Promise<ChatConversationEntity> {
    const conversation = await this.conversations.findOne({ where: { id } });
    if (!conversation) throw new NotFoundException('Conversation not found');
    this.member(conversation, userId);
    return conversation;
  }

  async open(
    userId: string,
    dto: OpenConversationDto,
  ): Promise<ChatConversationEntity> {
    let emitted: ChatMessageEntity | undefined;
    const result = await this.dataSource.transaction(async (manager) => {
      const shop = await manager.getRepository(ShopEntity).findOne({
        where: { id: dto.shopId, status: 'ACTIVE', deletedAt: IsNull() },
      });
      if (!shop) throw new NotFoundException('Active shop not found');
      if (shop.sellerId === userId)
        throw new BadRequestException('Cannot chat with your own shop');
      const repo = manager.getRepository(ChatConversationEntity);
      let conversation = await repo.findOne({
        where: { buyerId: userId, shopId: shop.id },
      });
      if (!conversation) {
        await repo
          .createQueryBuilder()
          .insert()
          .values({ buyerId: userId, sellerId: shop.sellerId, shopId: shop.id })
          .orIgnore()
          .execute();
        conversation = await repo.findOneOrFail({
          where: { buyerId: userId, shopId: shop.id },
        });
      }
      conversation = await repo
        .createQueryBuilder('conversation')
        .setLock('pessimistic_write')
        .where('conversation.id = :id', { id: conversation.id })
        .getOneOrFail();
      if (dto.productSlug && dto.orderNumber)
        throw new BadRequestException('Choose one context');
      if (dto.productSlug)
        emitted = await this.addProductContext(
          manager,
          conversation,
          shop,
          dto.productSlug,
        );
      if (dto.orderNumber)
        emitted = await this.addOrderContext(
          manager,
          conversation,
          shop,
          dto.orderNumber,
        );
      return repo.findOneOrFail({ where: { id: conversation.id } });
    });
    if (emitted) this.events.emit(result.sellerId, 'message:new', emitted);
    return result;
  }

  private async addProductContext(
    manager: import('typeorm').EntityManager,
    c: ChatConversationEntity,
    shop: ShopEntity,
    slug: string,
  ): Promise<ChatMessageEntity | undefined> {
    const product = await manager.getRepository(ProductEntity).findOne({
      where: {
        slug,
        sellerId: shop.sellerId,
        status: ProductStatus.ACTIVE,
        deletedAt: IsNull(),
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    const recent = await manager
      .getRepository(ChatMessageEntity)
      .createQueryBuilder('m')
      .where(
        'm.conversation_id = :id AND m.type = :type AND m.created_at > :since',
        { id: c.id, type: 'PRODUCT', since: new Date(Date.now() - 300_000) },
      )
      .andWhere("m.context ->> 'productSlug' = :slug", { slug })
      .getOne();
    if (recent) return undefined;
    const [image, raw] = await Promise.all([
      manager.getRepository(ProductImageEntity).findOne({
        where: { productId: product.id },
        order: { isPrimary: 'DESC', sortOrder: 'ASC' },
      }),
      manager
        .getRepository(ProductSkuEntity)
        .createQueryBuilder('sku')
        .select('MIN(sku.price)', 'min')
        .where('sku.product_id = :id AND sku.is_active = true', {
          id: product.id,
        })
        .getRawOne<{ min: string | null }>(),
    ]);
    return this.persistContext(manager, c, c.buyerId, 'PRODUCT', {
      productSlug: slug,
      name: product.name,
      imageUrl: image?.url ?? null,
      minPrice: raw?.min ?? null,
    });
  }

  private async addOrderContext(
    manager: import('typeorm').EntityManager,
    c: ChatConversationEntity,
    shop: ShopEntity,
    orderNumber: string,
  ): Promise<ChatMessageEntity | undefined> {
    const order = await manager.getRepository(OrderEntity).findOne({
      where: { orderNumber, buyerId: c.buyerId, sellerId: shop.sellerId },
    });
    if (!order) throw new NotFoundException('Order not found');
    const recent = await manager
      .getRepository(ChatMessageEntity)
      .createQueryBuilder('m')
      .where(
        'm.conversation_id = :id AND m.type = :type AND m.created_at > :since',
        { id: c.id, type: 'ORDER', since: new Date(Date.now() - 300_000) },
      )
      .andWhere("m.context ->> 'orderNumber' = :orderNumber", { orderNumber })
      .getOne();
    if (recent) return undefined;
    return this.persistContext(manager, c, c.buyerId, 'ORDER', {
      orderNumber,
      status: order.status,
      totalAmount: order.total,
    });
  }

  private async persistContext(
    manager: import('typeorm').EntityManager,
    c: ChatConversationEntity,
    senderId: string,
    type: 'PRODUCT' | 'ORDER',
    context: Record<string, unknown>,
  ): Promise<ChatMessageEntity> {
    const message = await manager.getRepository(ChatMessageEntity).save({
      conversationId: c.id,
      senderId,
      senderRole: 'BUYER',
      type,
      clientMessageId: randomUUID(),
      context,
      text: null,
      attachment: null,
      readAt: null,
    });
    await manager
      .getRepository(ChatConversationEntity)
      .increment({ id: c.id }, 'sellerUnreadCount', 1);
    await manager.getRepository(ChatConversationEntity).update(c.id, {
      lastMessageAt: message.createdAt,
      lastMessagePreview: type === 'PRODUCT' ? 'Product' : 'Order',
    });
    return message;
  }

  async list(userId: string): Promise<ChatConversationEntity[]> {
    return this.conversations
      .createQueryBuilder('c')
      .where('c.buyer_id = :userId OR c.seller_id = :userId', { userId })
      .orderBy('c.last_message_at', 'DESC', 'NULLS LAST')
      .addOrderBy('c.created_at', 'DESC')
      .getMany();
  }

  async history(
    userId: string,
    id: string,
    query: HistoryQueryDto,
  ): Promise<{ items: ChatMessageEntity[]; nextCursor: string | null }> {
    await this.conversationFor(userId, id);
    const qb = this.messages
      .createQueryBuilder('m')
      .where('m.conversation_id = :id', { id });
    if (query.cursor) {
      let parsed: { createdAt: string; id: string };
      try {
        parsed = JSON.parse(
          Buffer.from(query.cursor, 'base64url').toString(),
        ) as typeof parsed;
      } catch {
        throw new BadRequestException('Invalid cursor');
      }
      const date = new Date(parsed.createdAt);
      if (!isUUID(parsed.id) || Number.isNaN(date.valueOf()))
        throw new BadRequestException('Invalid cursor');
      qb.andWhere(
        new Brackets((x) =>
          x
            .where('m.created_at < :at', { at: date })
            .orWhere('m.created_at = :at AND m.id < :cursorId', {
              at: date,
              cursorId: parsed.id,
            }),
        ),
      );
    }
    const items = await qb
      .orderBy('m.created_at', 'DESC')
      .addOrderBy('m.id', 'DESC')
      .take(query.limit + 1)
      .getMany();
    const more = items.length > query.limit;
    if (more) items.pop();
    const last = more ? items.at(-1) : undefined;
    return {
      items,
      nextCursor: last
        ? Buffer.from(
            JSON.stringify({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            }),
          ).toString('base64url')
        : null,
    };
  }

  private validateImage(dto: SendMessageDto): void {
    const image = dto.image;
    if (
      !image ||
      image.size > MAX_IMAGE_FILE_SIZE ||
      !ALLOWED_IMAGE_MIME_TYPES.includes(image.mimeType as never)
    )
      throw new BadRequestException('Invalid image');
    if (
      !this.storagePrefix.startsWith('http') ||
      !image.url.startsWith(this.storagePrefix) ||
      image.url !== `${this.storagePrefix}${image.key}` ||
      !image.key.startsWith('chat/')
    )
      throw new BadRequestException('Image is not from Nexus chat storage');
  }

  async send(
    userId: string,
    id: string,
    dto: SendMessageDto,
  ): Promise<{ message: ChatMessageEntity; duplicate: boolean }> {
    if (dto.type === 'TEXT') {
      dto.text = dto.text?.trim();
      if (!dto.text) throw new BadRequestException('Message text is required');
    }
    if (dto.type === 'IMAGE') this.validateImage(dto);
    const existing = await this.messages.findOne({
      where: { senderId: userId, clientMessageId: dto.clientMessageId },
    });
    if (existing) {
      if (existing.conversationId !== id)
        throw new ConflictException('clientMessageId already used');
      return { message: existing, duplicate: true };
    }
    try {
      const result = await this.dataSource.transaction(async (manager) => {
        const c = await manager
          .getRepository(ChatConversationEntity)
          .createQueryBuilder('c')
          .setLock('pessimistic_write')
          .where('c.id = :id', { id })
          .getOne();
        if (!c) throw new NotFoundException('Conversation not found');
        const role = this.member(c, userId);
        const message = await manager.getRepository(ChatMessageEntity).save({
          conversationId: id,
          senderId: userId,
          senderRole: role,
          type: dto.type,
          clientMessageId: dto.clientMessageId,
          text: dto.type === 'TEXT' ? dto.text! : null,
          attachment: dto.type === 'IMAGE' ? { ...dto.image! } : null,
          context: null,
          readAt: null,
        });
        const recipientId = role === 'BUYER' ? c.sellerId : c.buyerId;
        await manager
          .getRepository(ChatConversationEntity)
          .increment(
            { id },
            role === 'BUYER' ? 'sellerUnreadCount' : 'buyerUnreadCount',
            1,
          );
        await manager.getRepository(ChatConversationEntity).update(id, {
          lastMessageAt: message.createdAt,
          lastMessagePreview:
            dto.type === 'TEXT' ? dto.text!.slice(0, 255) : 'Image',
        });
        return { message, recipientId };
      });
      this.events.emit(result.recipientId, 'message:new', result.message);
      return { message: result.message, duplicate: false };
    } catch (error) {
      if ((error as { code?: string }).code !== '23505') throw error;
      const message = await this.messages.findOne({
        where: { senderId: userId, clientMessageId: dto.clientMessageId },
      });
      if (!message || message.conversationId !== id)
        throw new ConflictException('clientMessageId already used');
      return { message, duplicate: true };
    }
  }

  async markRead(
    userId: string,
    id: string,
  ): Promise<{ readAt: Date; updated: number }> {
    const readAt = new Date();
    const result = await this.dataSource.transaction(async (manager) => {
      const c = await manager
        .getRepository(ChatConversationEntity)
        .createQueryBuilder('conversation')
        .setLock('pessimistic_write')
        .where('conversation.id = :id', { id })
        .getOne();
      if (!c) throw new NotFoundException('Conversation not found');
      const role = this.member(c, userId);
      const update = await manager.getRepository(ChatMessageEntity).update(
        {
          conversationId: id,
          senderId: role === 'BUYER' ? c.sellerId : c.buyerId,
          readAt: IsNull(),
          createdAt: LessThanOrEqual(readAt),
        },
        { readAt },
      );
      await manager
        .getRepository(ChatConversationEntity)
        .update(
          id,
          role === 'BUYER' ? { buyerUnreadCount: 0 } : { sellerUnreadCount: 0 },
        );
      return {
        updated: update.affected ?? 0,
        counterpart: role === 'BUYER' ? c.sellerId : c.buyerId,
      };
    });
    this.events.emit(result.counterpart, 'message:read', {
      conversationId: id,
      userId,
      readAt,
    });
    return { readAt, updated: result.updated };
  }

  async unread(userId: string): Promise<{ total: number }> {
    const rows = await this.conversations
      .createQueryBuilder('c')
      .select(
        'COALESCE(SUM(CASE WHEN c.buyer_id = :userId THEN c.buyer_unread_count ELSE c.seller_unread_count END),0)',
        'total',
      )
      .where('c.buyer_id = :userId OR c.seller_id = :userId', { userId })
      .getRawOne<{ total: string }>();
    return { total: Number(rows?.total ?? 0) };
  }

  async counterpart(userId: string, id: string): Promise<string> {
    const c = await this.conversationFor(userId, id);
    return c.buyerId === userId ? c.sellerId : c.buyerId;
  }
}
