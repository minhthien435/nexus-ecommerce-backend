import {
  AI_ASSISTANT_BASE_SYSTEM_PROMPT,
  buildAiAssistantSystemPrompt,
} from './system-prompt.js';

describe('buildAiAssistantSystemPrompt', () => {
  it('includes core grounding, multimodal, UI actions, and anti-injection rules in base prompt', () => {
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('Nexus Assistant');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain(
      'MULTIMODAL VISUAL SEARCH',
    );
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('search_products');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('189.000đ');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('SHOW_PRODUCTS');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('NAVIGATE');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('OPEN_SEARCH');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('HANDOFF_TO_SHOP');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('shopSlug');
    expect(AI_ASSISTANT_BASE_SYSTEM_PROMPT).toContain('prompt injection');
  });

  it('injects currentPath context and authenticated order-tracking capability', () => {
    const prompt = buildAiAssistantSystemPrompt({
      currentPath: '/products/ao-polo-compact',
      currentProductSlug: 'ao-polo-compact',
      isAuthenticated: true,
    });

    expect(prompt).toContain('/products/ao-polo-compact');
    expect(prompt).toContain('ao-polo-compact');
    expect(prompt).toContain('ĐÃ ĐĂNG NHẬP');
    expect(prompt).toContain('track_my_order');
  });

  it('marks guest users as unauthenticated when building context', () => {
    const prompt = buildAiAssistantSystemPrompt({
      isAuthenticated: false,
    });

    expect(prompt).toContain('KHÁCH VÃNG LAI');
  });

  it('injects auction context, rules, and SHOW_AUCTIONS instructions when viewing an auction', () => {
    const prompt = buildAiAssistantSystemPrompt({
      currentPath: '/auctions/AUC-088618-PPBI',
      currentAuctionIdOrCode: 'AUC-088618-PPBI',
      isAuthenticated: true,
      hasAuctionTools: true,
    });

    expect(prompt).toContain('AUC-088618-PPBI');
    expect(prompt).toContain('get_auction_detail');
    expect(prompt).toContain('get_my_auction_participations');
    expect(prompt).toContain('SHOW_AUCTIONS');
    expect(prompt).toContain('60 giây cuối');
    expect(prompt).toContain('reservePrice');
  });
});
