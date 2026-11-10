import { ServiceUnavailableException } from '@nestjs/common';
import type { AiProductCard } from '../contracts/ai-assistant.types.js';
import {
  DefaultAiUiActionGuard,
  PlaceholderAiModelClient,
} from './ai-fallback.adapters.js';

describe('DefaultAiUiActionGuard', () => {
  const guard = new DefaultAiUiActionGuard();
  const observedProducts: AiProductCard[] = [
    {
      slug: 'ao-hoodie-ni-xam-oversize',
      name: 'Áo Hoodie Nỉ Xám Oversize',
      minPrice: '280000.00',
      originalPrice: '350000.00',
      imageUrl: 'https://cdn.nexus.vn/hoodie.jpg',
      unitsSold: 94,
      shop: { name: 'Nexus Fashion', slug: 'nexus-fashion' },
    },
  ];

  it('allows NAVIGATE only when slug exists in observed DB results and builds internal /products path', async () => {
    const action = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: {
          type: 'NAVIGATE',
          slug: 'ao-hoodie-ni-xam-oversize',
          url: 'https://evil-phishing-site.com',
        },
      },
      observedProducts,
    );

    expect(action).toEqual({
      type: 'NAVIGATE',
      slug: 'ao-hoodie-ni-xam-oversize',
      url: '/products/ao-hoodie-ni-xam-oversize',
    });
  });

  it('blocks NAVIGATE when AI hallucinates a non-existent slug', async () => {
    const action = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: { type: 'NAVIGATE', slug: 'san-pham-bia-ra-khong-co-that' },
      },
      observedProducts,
    );

    expect(action).toBeNull();
  });

  it('builds safe internal OPEN_SEARCH URL with numeric price bounds', async () => {
    const action = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: {
          type: 'OPEN_SEARCH',
          searchQuery: 'áo thun cotton',
          minPrice: 100000,
          maxPrice: 250000,
        },
      },
      [],
    );

    expect(action).toEqual({
      type: 'OPEN_SEARCH',
      searchQuery: 'áo thun cotton',
      url: '/search?q=%C3%A1o+thun+cotton&minPrice=100000&maxPrice=250000',
    });
  });

  it('allows HANDOFF_TO_SHOP only for verified shopSlug / productSlug from turn results', async () => {
    const valid = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: {
          type: 'HANDOFF_TO_SHOP',
          shopSlug: 'nexus-fashion',
          productSlug: 'ao-hoodie-ni-xam-oversize',
        },
      },
      observedProducts,
    );

    expect(valid).toEqual({
      type: 'HANDOFF_TO_SHOP',
      shopSlug: 'nexus-fashion',
      productSlug: 'ao-hoodie-ni-xam-oversize',
    });

    const validViaSlugAlias = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: {
          type: 'HANDOFF_TO_SHOP',
          slug: 'ao-hoodie-ni-xam-oversize',
        },
      },
      observedProducts,
    );
    expect(validViaSlugAlias).toEqual({
      type: 'HANDOFF_TO_SHOP',
      shopSlug: 'nexus-fashion',
      productSlug: 'ao-hoodie-ni-xam-oversize',
    });

    const spoofedShop = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: {
          type: 'HANDOFF_TO_SHOP',
          shopSlug: 'fake-scam-shop',
        },
      },
      observedProducts,
    );
    expect(spoofedShop).toBeNull();

    const allowedViaOrder = await guard.verifyAndBuildAction(
      {
        name: 'ui_action',
        args: {
          type: 'HANDOFF_TO_SHOP',
          shopSlug: 'official-tech-shop',
        },
      },
      [],
      { allowedShopSlugs: ['official-tech-shop'] },
    );
    expect(allowedViaOrder).toEqual({
      type: 'HANDOFF_TO_SHOP',
      shopSlug: 'official-tech-shop',
    });
  });
});

describe('PlaceholderAiModelClient', () => {
  it('throws 503 AI_UNAVAILABLE when model client is not wired', async () => {
    const client = new PlaceholderAiModelClient();
    await expect(
      client.generateTurn({
        systemPrompt: 'sys',
        history: [],
        userMessage: 'hi',
        toolDeclarations: [],
        toolRoundMessages: [],
      }),
    ).rejects.toMatchObject({
      status: 503,
      response: expect.objectContaining({ errorCode: 'AI_UNAVAILABLE' }),
    });

    await expect(
      client.generateTurn({
        systemPrompt: 'sys',
        history: [],
        userMessage: 'hi',
        toolDeclarations: [],
        toolRoundMessages: [],
      }),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
