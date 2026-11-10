# Hoang AI backend handoff (BE-11 / BE-12 / BE-13)

## Integration blocker: intentionally not a live endpoint

`AppModule` does **not** import the AI module. Minh must supply real orchestration, authenticated access, session ownership checks and rate limiting before enabling it. This change does not provide a fake working assistant, persistence, analytics, detail tools or order mutation. Khoa owns analytics/detail tools. `HANDOFF_TO_SHOP` is deferred and is not an executable tool here.

The opt-in controller is `POST /api/v1/ai/chat`. The existing `TransformInterceptor` wraps its result once as `{ "success": true, "data": ... }`. Invalid input produces 400; denied access 403; sanitized Gemini failures 503. No production Gemini request or recognition-quality evaluation was performed; tests use fakes.

## Environment and SDK

Set server-only `GEMINI_API_KEY` and `GEMINI_MODEL` locally; there is no default model. Select a model actually enabled for your Google project. Do not put keys in frontend configuration or logs. `.env` is untouched. Image URLs use the existing `SUPABASE_URL` and `SUPABASE_STORAGE_BUCKET`.

Official SDK API checked against [Google Gen AI JavaScript documentation](https://googleapis.github.io/js-genai/release_docs/index.html). The installed `@google/genai` type declarations confirm `generateContent`, `parametersJsonSchema`, abort signals, safety settings and `httpOptions.retryOptions.attempts` (1 disables SDK retries). The client permits at most three total attempts on 429/500/502/503/504, with 200/400 ms delays, under one 15-second deadline. Authentication errors are not retried. It never executes model tools automatically. Runtime requires Node 22+ for the installed SDK.

## Exact integration contract

```ts
AiAssistantModule.register({
  // These classes are implemented by Minh, not included in this change.
  orchestrator: { provide: AiOrchestrator, useClass: MinhAiOrchestrator },
  accessPolicy: { provide: AiAccessPolicy, useClass: MinhAiAccessPolicy },
  imports: [MinhSessionModule],
});
```

The registration requires both explicit provider tokens. Imported modules must export dependencies used by those classes; additional providers can be passed via `providers`. Existing instances can use `useExisting` with their exporting module in `imports`. There is no default permissive policy. `AiAccessPolicy.canActivate(context)` must authenticate and rate-limit before the controller runs. `AiOrchestrator.chat(input, request)` receives the parsed DTO and the HTTP request so it can bind the session to the authenticated principal. Session IDs and `context.currentUrl` / `context.currentProductSlug` are hints, never authorization or product evidence.

`AiChatResult` is `{ sessionId, reply, products, action, suggestions }`. `products` are `AiProduct[]`, `action` is one validated action or null, and `suggestions` is a string array. Monetary values remain decimal strings or null; no currency is invented.

Minh must call `GeminiClientService.prepareUserContent(input)` **before** `generate(contents)`: this validates/decodes images and produces text/inlineData parts. `generate` accepts trusted server-built conversation contents, with default declarations `search_products` and `ui_action`; it returns the SDK response, including function calls, for Minh's bounded orchestration loop. Preserve model content/thought signatures when appending tool results. Allowlist tool names and pass each function's unknown arguments to its validator; never execute arbitrary function names or trust free-text URLs/product claims. Build returned product cards from `SearchProductsTool.execute` results. Keep those results in a fresh local variable for each HTTP request and pass only that variable to `UiActionHandler.execute`. Do not retain navigation evidence in a singleton/session or accept it from the model/client. Reject unsupported tools; impose a bounded number of tool rounds. Khoa can supply additional read-only declarations through `generate` when integrated. Minh can pass the trusted BE-03 server prompt as the optional third argument, `generate(contents, declarations, systemInstruction)` (pass `undefined` for declarations to retain the defaults). Omitting it retains the safe catalog prompt. Never derive this argument from HTTP input; the request parser rejects prompt fields at both the top level and inside context. Context `currentUrl` accepts a bounded internal path or absolute HTTP(S) URL without credentials; it is never fetched or used as an action destination. `currentProductSlug` must be a bounded lowercase hyphenated slug and does not establish product evidence.

### Request body limit before registration

The current application has Express's default JSON size limit, too small for 5 MiB images encoded as Base64. When enabling the module, configure a bounded 7 MiB JSON parser before Nest's default parser, preferably scoped to this route; keep the normal smaller limit elsewhere. For example, create the app with `{ bodyParser: false }`, register `express.json({ limit: '7mb' })` on `/api/v1/ai/chat`, then normal JSON/urlencoded parsers for other routes. Ensure the reverse proxy also accepts this bound. The module HTTP test uses Nest's `useBodyParser('json', { limit: '7mb' })` on an isolated test app and checks a body over 100 KB. Application bootstrap remains unchanged until integration.

## API examples

```json
{
  "sessionId": "session_123",
  "message": "Find red shoes",
  "context": {
    "currentUrl": "/products/red-shoe",
    "currentProductSlug": "red-shoe"
  }
}
```

```json
{
  "message": "Find something similar",
  "imageUrl": "https://YOUR_PROJECT.supabase.co/storage/v1/object/public/YOUR_BUCKET/shoe.png"
}
```

```json
{ "imageBase64": "BASE64_BYTES_ONLY", "imageMimeType": "image/png" }
```

Omit sessionId on a new session; Minh allocates it. Message max 4,000 characters; session ID max 128 alphanumeric/underscore/hyphen characters. Images may accompany text or stand alone. Supply exactly one image source. Raw, canonical Base64 requires imageMimeType; data URLs are unsupported. JPEG/PNG/WebP only, max 5 MiB decoded, max 16 million pixels, single frame, full successful decode required. Sharp rejects corrupt/truncated images and MIME mismatch.

URL images must be HTTPS on the exact configured Supabase project and public bucket path. Credentials, query strings, fragments, encoded paths, alternative hosts and redirects are rejected. Only public IPv4 resolutions are accepted; the vetted address is pinned to the HTTPS connection to prevent DNS rebinding. Retrieval has a 5-second deadline and streaming 5 MiB cap. IPv6-only/custom-domain/private/signed storage URLs are intentionally unsupported.

```json
{
  "name": "search_products",
  "args": {
    "query": "red shoes",
    "categorySlug": "footwear",
    "minPrice": 10,
    "maxPrice": 50,
    "sort": "relevance",
    "limit": 5
  }
}
```

`query` is required; categorySlug/minPrice/maxPrice/sort/limit are optional. Unknown keys, nonnumeric prices, reversed ranges and limits outside 1–5 are rejected. Active category slugs resolve through the catalog service; missing/inactive categories cannot broaden the search. Search reuses the catalog's active/undeleted product filtering and returns at most five cards, mapping `minimumPrice` → `minPrice`, `primaryImageUrl` → `imageUrl`. Relevance maps to catalog `newest`, whose keyword ranking already precedes its tie-break sort; price sorting also retains catalog keyword relevance precedence.

```json
{ "name": "ui_action", "args": { "type": "NAVIGATE", "slug": "red-shoe" } }
```

Navigation requires exact membership in this request's database results and constructs `/products/red-shoe` server-side. `SHOW_PRODUCTS` requires nonempty current results and returns `{ "type": "SHOW_PRODUCTS" }` with cards in top-level products. `OPEN_SEARCH` accepts bounded `searchQuery` and constructs `/search?q=<encoded query>`. URLs are never accepted as arguments. Unknown action types and fields are rejected.

Example wrapped response (illustrative, not a real database result):

```json
{
  "success": true,
  "data": {
    "sessionId": "session_123",
    "reply": "I found this product.",
    "products": [
      {
        "id": "PRODUCT_ID",
        "slug": "red-shoe",
        "name": "Red shoe",
        "minPrice": "12.50",
        "currency": "USD",
        "imageUrl": null
      }
    ],
    "action": { "type": "NAVIGATE", "url": "/products/red-shoe" },
    "suggestions": []
  }
}
```

## Verification

Focused tests cover request parsing, actual image decoding, MIME/size rejection, storage address checks, catalog adaptation, request-local navigation, bounded Gemini retry/deadline/error sanitization, and Nest registration/HTTP access/response wrapping with fake contracts. Full repository lint, typecheck, tests and build are recorded in the implementation handoff. Real database, storage and Gemini integration remains for Minh's protected end-to-end assembly; mocks do not prove recognition quality or live credential/model availability.
