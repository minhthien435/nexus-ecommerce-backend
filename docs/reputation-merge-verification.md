# Kiểm chứng bổ sung trước merge — Reputation của Duy

Ngày: 17/11/2026. **Chưa kết luận sẵn sàng merge:** mục lưu đơn và chế độ DB bắt buộc đã được kiểm chứng; chuỗi migration thật vẫn thiếu bootstrap nên chưa chạy tới migration mới.

## 1. Phạm vi và revision

- Nhánh sửa: `feat/duy/reputation-seller-threshold`.
- Base của đợt bổ sung: `0c8ba8ec84e3433870c00694118ee6cf21423771`.
- Target đã fetch lại: `origin/main`, `ddb3d57173601d5bc174bcd7e727aaf105789326`.
- BE-REP-02 giữ nguyên nhánh `feat/duy/reputation-seller-threshold-70`, commit `1eddece880b38fa97c7b130783d8c33dc2eef364`; không sửa, rebase, merge hoặc chạy lại dữ liệu chung cho nhánh này.
- Seller vẫn 50 trên nhánh hiện tại. Không push, merge, deploy, ghi DB chung hoặc sửa migration lịch sử.

## 2. Chứng minh processor không cần save đơn lần nữa

Đã đọc implementation thật tại `src/modules/commerce/services/order-state-machine.service.ts`:

1. `transition()` kiểm tra transaction đang hoạt động, khóa/đọc `OrderEntity` rồi `await applyTransition(...)`.
2. `applyTransition()` kiểm tra chuyển trạng thái hợp lệ, gán `order.status = toStatus`, rồi `await manager.getRepository(OrderEntity).save(order)`.
3. Ngay sau đó, cùng manager, hàm tạo/lưu `OrderStatusHistoryEntity` với `fromStatus`, `toStatus`, `reason`, `changedBy`.
4. Processor gọi transition và thưởng reputation trong cùng transaction caller-owned. Vì vậy `orderRepo.save(completed)` ở processor là dư; không cần thêm lại. Không phát hiện lỗi production ở đường lưu này và không sửa logic production.

Suite PostgreSQL hiện dùng processor, `OrderStateMachineService`, `IdentityReputationService` và metadata `OrderEntity`/`OrderStatusHistoryEntity` thật, `synchronize:false`. Đã bỏ transition stub tự phát SQL UPDATE. Các test chứng minh:

- Đơn DELIVERED đủ thời hạn thực sự được đọc lại là COMPLETED từ DB.
- Lịch sử có chính xác bản ghi DELIVERED → COMPLETED mới, với reason/actor/timestamp; shop có ledger +5 và điểm tương ứng.
- Đơn đã COMPLETED từ trước vẫn được xét độc lập; đơn chưa qua hạn không hoàn tất.
- Gọi processor lần nữa không tạo thêm lịch sử hoặc điểm.
- Trigger PostgreSQL AFTER UPDATE gây lỗi ở lần cập nhật shop cuối, sau khi order/history/ledger đã được ghi. Transaction rollback toàn bộ: đơn và lịch sử bằng snapshot trước chạy, không ledger, điểm shop giữ nguyên. Gỡ trigger rồi retry thành công, lần gọi tiếp theo vẫn idempotent.

Đây là kiểm chứng integration thật trên fixture DB cô lập, **không phải** bằng chứng đã chạy hết chuỗi migration lịch sử.

## 3. Chuỗi migration thật: đã thử, đang bị chặn

Lệnh thực tế:

```powershell
# URL đã được cung cấp rõ cho DB loopback mới, rỗng, chuyên dụng.
# Không ghi giá trị kết nối hoặc thông tin đăng nhập vào báo cáo.
npm.cmd run test:reputation:migrations
```

Script chạy `npm run build && node scripts/test-reputation-migrations.mjs`. Build exit 0. Harness load **31 migration thật** từ `dist/database/migrations/*.js`, dùng `runMigrations({ transaction: 'all' })`, không fixture, không synchronize và không dựng schema nền.

**Kết quả: exit 1**, PostgreSQL `3F000`, tại migration đầu tiên `AddAvatarUrlToUsers1760076000000`:

```text
ALTER TABLE "identity"."users" ADD "avatar_url" varchar(2048)
schema "identity" does not exist
```

Migration `DurableReputationRewards1794873600000` **chưa được chạy tới**. Không có file SQL bootstrap được Git quản lý hoặc migration tạo các schema/bảng nền trong checkout này. Không tự sửa migration cũ hay chèn fixture để lách bước kiểm chứng. Harness yêu cầu biến `REPUTATION_MIGRATION_TEST_DATABASE_URL`, chỉ chấp nhận DB local có đúng tên test chuyên dụng và từ chối DB đã có bảng. Sau lần thử thất bại, bảng metadata migration rỗng có thể còn lại; lần chạy lại cần DB test rỗng mới, không tự xóa bảng của môi trường khác.

Cần cung cấp baseline/schema bootstrap chính thức tương thích với chuỗi migration, sau đó chạy lại toàn chuỗi trên DB cô lập trước khi xác nhận mục này hoàn tất. Kết quả không chứng minh migration mới bị lỗi; nó chứng minh repo hiện chưa tự dựng được DB từ đầu chỉ bằng chuỗi migration đã có.

## 4. Suite PostgreSQL bắt buộc và test/CI

Các entry point mới, dùng Vitest hiện có:

| Lệnh                                            | Cách hoạt động                                                                                                                      |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `npm.cmd run test:reputation:db`                | Runner Node portable, buộc `REPUTATION_TEST_DATABASE_REQUIRED=1`, chạy đúng spec của checkout hiện tại và truyền exit code ra ngoài |
| `npm.cmd run test:cov` với required flag bằng 1 | Chạy full backend; spec ném lỗi nếu thiếu `REPUTATION_TEST_DATABASE_URL`                                                            |
| `npm.cmd run test:reputation:migrations`        | Build và chạy lịch sử migration trên DB cô lập rỗng riêng                                                                           |
| `npm.cmd run validate:reputation`               | Ghép suite DB bắt buộc, validation thường của repo và kiểm tra lịch sử migration; chưa tuyên bố entry point này pass end to end     |

Không có pipeline CI được quản lý trong repo để chỉnh trực tiếp; không tự dựng pipeline deploy. Khi đưa vào CI, gọi entry point bắt buộc và cấp hai URL DB test cô lập rõ ràng. Hiện bước lịch sử migration vẫn sẽ chặn validation cho tới khi có bootstrap hợp lệ.

Không đọc `.env` hoặc fallback sang DB ứng dụng. Guard chỉ chấp nhận loopback/đúng DB test; query parameter trong URL test bị từ chối. Test thông thường vẫn có chế độ tùy chọn để chạy unit test không cần DB, nhưng không dùng kết quả skip đó để kết luận DB đã được kiểm chứng.

Do worktree BE-REP-02 nằm lồng dưới thư mục artifact được ignore, pattern cũ `**/*.spec.ts` có thể phát hiện cả test của checkout khác và làm hai fixture tranh schema. Đã giới hạn discovery về `src/**/*.spec.ts` và `test/**/*.spec.ts`. **Toàn bộ 167 spec được Git quản lý vẫn nằm trong hai root này**; không bỏ test backend, đổi coverage include/exclude hay hạ threshold.

## 5. Lệnh đã chạy, pass/skip và exit

| Kiểm tra                                                                                                                                                                        | Exit | Pass / skip / fail                                                                    |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------- |
| `npm.cmd run test:reputation:db`, URL cô lập hợp lệ                                                                                                                             | 0    | 32 / 0 / 0, 1 file                                                                    |
| Cùng lệnh, thiếu URL và caller không bật flag                                                                                                                                   | 1    | 0 test chạy; suite fail trước tạo DataSource; không được tính là pass/skip thành công |
| `npm.cmd exec -- vitest run src/modules/identity/services/reputation-postgres.spec.ts --reporter=json --outputFile=_bmad-output/reputation-optional-tests.json`, thiếu URL/flag | 0    | 0 / 32 / 0, skip tùy chọn hiển thị rõ                                                 |
| Full coverage bên dưới, URL rõ và required flag bằng 1                                                                                                                          | 0    | **1394 / 0 / 0**, 167 file, 0 todo; gồm đủ 32 test DB                                 |
| `npm.cmd run lint`                                                                                                                                                              | 0    | Pass                                                                                  |
| `npm.cmd run typecheck`                                                                                                                                                         | 0    | Pass                                                                                  |
| `npm.cmd run build`                                                                                                                                                             | 0    | Pass                                                                                  |
| `node --check scripts/test-reputation-migrations.mjs`                                                                                                                           | 0    | Pass                                                                                  |
| `npm.cmd run test:reputation:migrations`                                                                                                                                        | 1    | Build pass; chuỗi bị chặn ở migration đầu, mới chưa tới                               |
| `git diff --check`                                                                                                                                                              | 0    | Pass                                                                                  |

Lệnh coverage thực tế, không sửa phạm vi đo:

```powershell
# REPUTATION_TEST_DATABASE_URL đã được cấp rõ, không dùng DB chung.
$env:REPUTATION_TEST_DATABASE_REQUIRED='1'
npm.cmd run test:cov -- --coverage.reporter=text --coverage.reporter=json-summary --coverage.reporter=json --reporter=default --reporter=json --outputFile=_bmad-output/reputation-supplemental-tests.json
```

Lần chạy ban đầu bị discovery trùng worktree làm namespace fixture tranh nhau; một lỗi type inference của tham số fixture cũng xuất hiện khi mở rộng schema. Hai lỗi test harness đã được sửa trước kết quả cuối, không bị che bằng skip. Không chạy đồng thời hai suite ghi cùng DB fixture. Tất cả kết quả cuối phía trên dùng checkout hiện tại riêng biệt.

## 6. Coverage thực tế và các giới hạn

| File / phạm vi                   | Statements         | Branches                       | Functions          | Lines              |
| -------------------------------- | ------------------ | ------------------------------ | ------------------ | ------------------ |
| Toàn backend                     | 86,76% (6641/7654) | 75,24% (3992/5305)             | 82,74% (1189/1437) | 87,95% (6412/7290) |
| `identity-reputation.service.ts` | 96,33% (105/109)   | 85,45% (47/55)                 | 100% (15/15)       | 99,02% (102/103)   |
| `order-completion.processor.ts`  | 100% (16/16)       | 100% theo V8, **0/0 nhánh JS** | 100% (3/3)         | 100% (16/16)       |
| `order-state-machine.service.ts` | 96,15% (50/52)     | 93,10% (27/29)                 | 100% (8/8)         | 97,91% (47/48)     |
| `profile.service.ts`             | 100% (25/25)       | 100% (14/14)                   | 100% (7/7)         | 100% (24/24)       |

Spec là mã test nên không có phần trăm coverage production theo mặc định; 32 case DB đã chạy thật. Hai CLI helper được kiểm chứng bằng subprocess/exit code, không được instrument trong full-suite V8 nên không gán phần trăm coverage cho chúng.

V8 không đo từng nhánh điều kiện SQL. SQL được kiểm tra bằng kết quả trên DB thật. Branch reputation chưa phủ gồm thiếu order/shop (dòng 148/166), nhánh TRUSTED ở khoảng 70–89 (217), một số fallback score/trust cũ (471/493/494/506/509). State machine còn thiếu nhánh checkout session không tồn tại khi finalize expiry và kết quả clock DB sai kiểu (117/160), ngoài đường completion mới kiểm chứng.

Chưa chạy toàn ứng dụng trên schema từ lịch sử migration do blocker đã nêu; chưa stress production hoặc chạy BullMQ/Redis thật. Không suy từ fixture pass thành chứng minh schema production tương thích hoàn toàn.

## 7. Review, conflict và bước còn lại

BMAD quick review không có finding. Sau fetch mới nhất, target vẫn là `ddb3d57173601d5bc174bcd7e727aaf105789326`. Kiểm tra merge-tree cuối trên commit bổ sung không làm thay đổi target; kết quả được ghi cùng bàn giao cục bộ. BE-REP-02 không được thay đổi hoặc tích hợp trong đợt này và chưa chứa các thay đổi kiểm chứng mới; cần phối hợp chuyển tiếp kiểm chứng khi chuẩn bị tích hợp nhánh đó sau này.

Mục 1 và 3 đã có bằng chứng kiểm thử. Mục 2 đã thực hiện đúng phép thử nhưng bị chặn: **còn cần bootstrap chính thức và một lượt chạy chuỗi migration thành công trước khi kết luận sẵn sàng merge**. Không sửa ngoài phạm vi để vượt blocker.

Các file thay đổi đợt này: `package.json`, `vitest.config.ts`, `src/modules/identity/services/reputation-postgres.spec.ts`, hai helper `scripts/test-reputation-db.mjs` / `scripts/test-reputation-migrations.mjs`, `docs/reputation-rewards.md`, `docs/reputation-verification.md` và báo cáo này. Không đổi service production, ngưỡng đấu giá hoặc migration lịch sử.
