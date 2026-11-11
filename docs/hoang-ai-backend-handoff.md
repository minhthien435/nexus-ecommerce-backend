# Bàn giao Hoàng — AI backend v2 (BE-11 / BE-12 / BE-13)

## Phạm vi và trạng thái

Endpoint `POST /api/v1/ai/chat` đã đăng ký trong AppModule. Mặc định trả **503 AI_UNAVAILABLE**, kể cả đã cấu hình Gemini, cho đến khi Minh thay provider điều phối. Có mẫu JSON chỉ bật rõ trong development/test để FE nối sớm. Mẫu không gọi Gemini/DB, không giả sản phẩm thật.

Hoàng cung cấp Gemini client, DTO/controller, JWT tùy chọn, kiểm tra ảnh, search_products, track_my_order, ui_action và dispatch allowlist. Không sửa Chat của Duy, không làm tool detail/trending/compare/price-insight của Khoa, không làm vòng lặp agent/session/Redis của Minh. AiSampleOrchestrator và AiSampleAccessPolicy là cầu nối tối thiểu để mở endpoint mẫu an toàn, không phải BE-01/02/03 đầy đủ.

## Mẫu chạy sớm

```dotenv
NODE_ENV=development
AI_MOCK_ENABLED=true
# Khi Minh nối agent thật:
GEMINI_API_KEY=<khóa riêng trên máy chủ>
GEMINI_MODEL=<model đang được hỗ trợ và bật trong dự án Google>
GEMINI_TIMEOUT_MS=15000
```

AI_MOCK_ENABLED=false là mặc định. Chỉ chuỗi `true` cùng NODE_ENV=development hoặc test được mở mẫu; production/staging/không cấu hình trả 503. Thiếu key/model không lỗi khởi tạo module. Không hardcode model chưa kiểm chứng. Timeout số nguyên 1–120000 ms, sai cấu hình dùng 15000. Tối đa 3 lần thử cùng một deadline; lỗi upstream được che. Không gọi Gemini thật khi test.

Request mẫu không cần đăng nhập:

```http
POST /api/v1/ai/chat
Content-Type: application/json

{
  "sessionId": "4f9b8c5a-1122-482a-9e58-69ebf4249a11",
  "message": "Tìm áo polo dưới 200k",
  "context": { "currentPath": "/products/ao-polo" }
}
```

Response mẫu chính xác:

```json
{
  "success": true,
  "statusCode": 200,
  "message": "OK",
  "data": {
    "reply": "Đây là dữ liệu mẫu để nối giao diện; trợ lý AI thật chưa được kết nối.",
    "products": [],
    "action": null,
    "suggestions": ["Tìm áo polo dưới 200k"]
  }
}
```

Mẫu không có thẻ sản phẩm để không hiểu nhầm fixture là DB thật. TransformInterceptor giữ nguyên envelope.

Request ảnh (JWT hợp lệ; upload trước bằng MediaModule, folder=ai):

```http
POST /api/v1/ai/chat
Authorization: Bearer <access-token>
Content-Type: application/json

{
  "sessionId": "4f9b8c5a-1122-482a-9e58-69ebf4249a11",
  "message": "",
  "image": {
    "url": "https://<project>.supabase.co/storage/v1/object/public/<bucket>/ai/1794-uuid.png",
    "key": "ai/1794-uuid.png"
  }
}
```

Thay project/bucket/key bằng kết quả upload thật. sessionId là UUID FE tạo, bắt buộc. Message là chuỗi tối đa 1000 ký tự, chỉ rỗng khi có image. Context chỉ nhận currentPath nội bộ, là gợi ý không đáng tin, không phải bằng chứng sản phẩm. Không nhận imageUrl, Base64, imageMimeType hoặc identity trong body.

Ảnh: URL bằng chính xác storagePrefix + key; file trực tiếp trong ai/, đuôi jpg/jpeg/png/webp. HTTPS đúng Supabase project/bucket cấu hình; cấm query/hash/credentials/encoded traversal/redirect. DNS chỉ public IPv4, ghim vào TLS. Tải tối đa 5 MiB trong 5 giây; MIME đúng bytes, decode đầy đủ, tối đa 16 triệu pixel và 1 frame. Không tăng JSON body limit. Chưa nhận GIF, IPv6-only, custom domain hoặc signed URL.

## Mã lỗi

| HTTP | errorCode               | Trường hợp                                                          |
| ---- | ----------------------- | ------------------------------------------------------------------- |
| 400  | AI_MESSAGE_INVALID      | Sai UUID/message/context/field không được phép                      |
| 400  | AI_IMAGE_INVALID        | Hợp đồng ảnh cũ, URL/key/bytes không hợp lệ                         |
| 401  | AI_IMAGE_LOGIN_REQUIRED | Guest gửi ảnh đúng hình dạng                                        |
| 401  | UNAUTHORIZED            | Có Authorization nhưng token sai/hết hạn/user khóa/tokenVersion sai |
| 401  | AI_ORDER_LOGIN_REQUIRED | Tool tra đơn không có principal đã xác minh                         |
| 429  | AI_RATE_LIMITED         | Vượt giới hạn mẫu; data.retryAfterSeconds và header Retry-After     |
| 503  | AI_UNAVAILABLE          | Agent chưa nối, mock bị cấm, thiếu key/model hoặc Gemini lỗi        |

503 có lời nhắn “Xin lỗi, trợ lý đang tạm bận. Bạn vui lòng thử lại hoặc mở trang tìm kiếm.” Envelope lỗi chung thêm timestamp/path. JWT dùng lại AccessTokenGuard của Identity, kiểm tra user ACTIVE/undeleted và tokenVersion. Không có Authorization là guest; token sai bị từ chối.

Bảo vệ mẫu: cửa sổ 60 giây, 10 lượt/IP guest hoặc 20 lượt/user, map tối đa 10000 khóa, đầy thì từ chối. Giới hạn cục bộ từng tiến trình, không phải bảo vệ phân tán. AI_RATE_LIMIT_GUEST/USER trong .env.example dành cho Minh; bridge hiện cố định 10/20. Không đọc X-Forwarded-For trực tiếp; proxy cần cấu hình trust proxy đúng trước khi dựa request.ip.

## Tool và dữ liệu

search_products dùng lại ProductSearchService/CategoryService, tối đa 5 candidate. SQL bổ sung có tham số, kiểm tra lại product/shop ACTIVE, undeleted trong DB dù catalog cache cũ. Shop lấy identity.shops, ảnh product_images, giá/originalPrice đúng SKU catalog đã chọn. Decimal là string, originalPrice nullable, không trả id/currency. unitsSold cộng order_items một lần cho đơn PAID/PROCESSING/SHIPPED/DELIVERED/COMPLETED, không nhân theo SKU. Đây là làm giàu thẻ search, không phải trending của Khoa. Candidate không có SKU/shop phù hợp bị loại; không tự tìm thêm trang nên có thể trả ít hơn limit.

Ví dụ hình dạng thẻ, chỉ minh họa:

```json
{
  "slug": "ao-polo",
  "name": "Áo polo",
  "imageUrl": null,
  "minPrice": "180000.00",
  "originalPrice": null,
  "unitsSold": 2,
  "shop": { "name": "Shop mẫu", "slug": "shop-mau" }
}
```

track_my_order({orderNumber}, verifiedUserId) chỉ nhận orderNumber từ model. SQL luôn có `order_number = $1 AND buyer_id = $2::uuid`. Kết quả `{status, trackingCode}` hoặc null; trackingCode chỉ khi carrier_name = GHN, không phân biệt hoa/thường. Không lộ địa chỉ/tổng tiền/ID. Đơn không tồn tại và đơn người khác đều null.

UiActionHandler.execute(args, currentProducts, actualUserMessage):

- SHOW_PRODUCTS cần sản phẩm hiện tại.
- NAVIGATE cần slug hiện tại và câu người dùng trực tiếp yêu cầu mở/dẫn tới sản phẩm. Model không thể cấp consent. Nhận diện bảo thủ, câu mơ hồ trả null.
- OPEN_SEARCH dựng /search?q= bằng encodeURIComponent.
- HANDOFF_TO_SHOP cần shopSlug/productSlug (hoặc slug sản phẩm) khớp cùng thẻ hiện tại.
- Field thừa, slug/shop lạ, action sai đều null, không ném lỗi HTTP.

## Điểm nối Minh/Khoa

Thay đăng ký mặc định trong AppModule, không import module AI thứ hai có controller trùng:

```ts
AiAssistantModule.register({
  orchestrator: { provide: AiOrchestrator, useClass: MinhAiOrchestrator },
  accessPolicy: { provide: AiAccessPolicy, useClass: MinhAiAccessPolicy },
  imports: [MinhSessionModule],
  providers: [/* dependency server cần thiết */],
});
```

AiOptionalAuthGuard chạy trước policy Minh. Policy quản lý quota/session ownership bằng request.user đã xác minh. AiOrchestrator.chat(input,request) trả `{reply, products, action, suggestions}`, products 0–5, suggestions 0–3, reply không link. Controller bọc envelope v2 và kiểm tra ảnh kể cả mẫu.

GeminiClientService.prepareUserContent(input) tạo user content với bytes đã decode trước generate. Controller hiện kiểm tra ảnh độc lập nên helper này sẽ tải/kiểm tra lại khi agent dùng; Minh có thể nối cache nội bộ theo request sau, tuyệt đối không lấy bytes “đã xác minh” từ client. `generate(contents, declarations?, trustedSystemPrompt?)` chỉ nhận prompt server (BE-03), không input. Declarations mặc định search_products, track_my_order, ui_action; không tự chạy function calls.

ToolExecutorService.execute(name,args,turn): Minh tạo turn mới mỗi request:

```ts
{ verifiedUserId: request.user?.id, userMessage: input.message, products: [] }
```

Không lấy identity từ model/sessionId/body. Search/đọc tool cập nhật evidence mới; ui_action chỉ đọc turn hiện tại. Câu “mở sản phẩm đầu tiên” tham chiếu lịch sử/currentPath phải gọi tool revalidate trong lượt này trước action, không seed products từ lịch sử/context.

Khoa nối provider abstract AiReadTools: execute(name,args) trả `{result, products}` đã kiểm tra ACTIVE/undeleted trong DB. Allowlist chỉ get_product_detail/get_trending_products/compare_products/get_price_insight; chưa có provider trả 503. Khoa sở hữu validators, SQL/cache và declarations. Minh sở hữu vòng lặp hữu hạn, session 6 lượt/TTL 30 phút, prompt tiếng Việt, chống prompt injection và lọc response cuối. Chưa hoàn thành end-to-end thật khi các phần này chưa nối.

## Kiểm chứng và giới hạn

48 focused tests đã qua: DTO/auth, storage URL/key, DNS/redirect/byte/decode/MIME/deadline, own/other order, điều kiện shop ACTIVE, action null/consent/evidence, timeout config, thiếu key vẫn tạo module, HTTP envelope, rate limit mẫu và production fail-closed. Dùng DB/Gemini/storage giả; không gọi Gemini thật, không đọc/sửa .env bí mật.

Kết quả toàn bộ npm run validate ghi trong báo cáo bàn giao. Chưa kiểm thử PostgreSQL/storage/Gemini thật, chất lượng nhận diện, session hoặc agent loop. Kiểm tra query bằng mock không thay integration DB. Không tuyên bố hoàn tất AI end-to-end.
Kết quả `npm run validate`: **PASS** — lint, typecheck, 140 test files / 1139 tests, build. Focused AI: 48/48. Lần chạy đầu bị chặn thao tác cache tạm trước khi load test; chạy lại với quyền truy cập file tạm bình thường đã qua. Không có lỗi kiểm thử còn mở.
