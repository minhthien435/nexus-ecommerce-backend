import {
  BadRequestException,
  Inject,
  Injectable,
  Optional,
} from '@nestjs/common';
import { aiUnavailable } from '../ai-errors.js';
import { SearchProductsTool, type AiProduct } from './search-products.tool.js';
import { TrackMyOrderTool } from './track-my-order.tool.js';
import { UiActionHandler } from './ui-action.handler.js';
export const KHOA_TOOLS = [
  'get_product_detail',
  'get_trending_products',
  'compare_products',
  'get_price_insight',
] as const;
/** Khoa validates arguments and returns only current ACTIVE/undeleted DB product evidence. */
export abstract class AiReadTools {
  abstract execute(
    name: (typeof KHOA_TOOLS)[number],
    args: unknown,
  ): Promise<{ result: unknown; products: AiProduct[] }>;
}
export type AiToolTurn = {
  readonly verifiedUserId?: string;
  readonly userMessage: string;
  products: AiProduct[];
};
@Injectable()
export class ToolExecutorService {
  constructor(
    @Inject(SearchProductsTool) private readonly search: SearchProductsTool,
    @Inject(TrackMyOrderTool) private readonly orders: TrackMyOrderTool,
    @Inject(UiActionHandler) private readonly actions: UiActionHandler,
    @Optional() @Inject(AiReadTools) private readonly readTools?: AiReadTools,
  ) {}
  /** Allocate a new turn on every request. Never seed products from history/client/model. */
  async execute(
    name: string,
    args: unknown,
    turn: AiToolTurn,
  ): Promise<unknown> {
    if (name === 'search_products') {
      const products = await this.search.execute(args);
      turn.products = products;
      return products;
    }
    if (name === 'track_my_order')
      return this.orders.execute(args, turn.verifiedUserId);
    if (name === 'ui_action')
      return this.actions.execute(args, turn.products, turn.userMessage);
    if (KHOA_TOOLS.includes(name as (typeof KHOA_TOOLS)[number])) {
      if (!this.readTools) throw aiUnavailable();
      const response = await this.readTools.execute(
        name as (typeof KHOA_TOOLS)[number],
        args,
      );
      turn.products = response.products.slice(0, 5);
      return response.result;
    }
    throw new BadRequestException('Unsupported AI tool');
  }
}
