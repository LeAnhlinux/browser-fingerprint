# Browser Fingerprint

Trình quản lý hồ sơ trình duyệt tách biệt (antidetect) dùng cá nhân, chạy hoàn toàn trên máy bạn. Mỗi hồ sơ có thư mục dữ liệu riêng, seed dấu vân tay riêng và proxy riêng (tuỳ chọn). Thiết kế (cả bốn giai đoạn đã xây xong) nằm trong `docs/superpowers/specs/2026-11-23-antidetect-browser-design.md`.

## Yêu cầu

- Node >= 22.12
- pnpm 10
- macOS. Mã cho Windows đã được viết nhưng chưa được kiểm thử.

## Chạy

```sh
pnpm install
pnpm dev
```

Lần chạy đầu tiên, ứng dụng tải nhân fingerprint-chromium (khoảng 140 MB) từ GitHub Releases và kiểm tra SHA-256 trước khi dùng. Đặt biến môi trường `BF_ENGINES_DIR` để dùng lại một thư mục nhân đã có.

## Kiểm thử

```sh
pnpm test                              # kiểm thử đơn vị của packages/core và packages/api
pnpm --filter @bf/core test:engine     # dùng nhân thật, mở cửa sổ trình duyệt thật trong vài giây
pnpm run build && pnpm --filter @bf/api test:engine   # API, CLI và MCP với nhân thật (trình duyệt chạy ẩn)
```

## Kiểm tra proxy và dịch vụ tra IP

Khi bấm "Kiểm tra" một proxy, app gửi đúng một request HTTP qua chính proxy đó tới dịch vụ tra IP để lấy IP đi ra, mã quốc gia và múi giờ. Mặc định là `http://ip-api.com/json/` (miễn phí cho mục đích phi thương mại, giới hạn khoảng 45 request mỗi phút). Request đi bằng HTTP thường nên nhà cung cấp proxy thấy được nội dung phản hồi.

Muốn dùng dịch vụ khác, đặt biến môi trường `BF_IP_LOOKUP_URL` trỏ tới một địa chỉ `http://` trả JSON. Địa chỉ không được chứa tên đăng nhập hay mật khẩu. Chỉ trường IP (`query` hoặc `ip`) là bắt buộc. Quốc gia (trong `countryCode` hoặc `country`) phải là mã 2 chữ cái, giá trị khác bị bỏ qua. `timezone` là tuỳ chọn và phải là tên IANA (ví dụ `Asia/Ho_Chi_Minh`).

Nếu proxy bị sửa trong lúc đang kiểm tra, lần kiểm tra đó thất bại với thông báo "Proxy đã thay đổi trong lúc kiểm tra, hãy kiểm tra lại"; bấm kiểm tra lại là được.

Khi dán danh sách proxy, dòng bắt đầu bằng `#` được coi là chú thích và bị bỏ qua; dòng dài hơn 2048 ký tự bị từ chối. Nếu dịch vụ tra IP trả HTTP 429 (giới hạn tốc độ), app báo đúng như vậy và không ghi đè kết quả kiểm tra trước đó của proxy.

## Cookie và extension

**Nhập cookie.** Bấm nút "Cookie" trên dòng hồ sơ, rồi dán JSON (kiểu xuất của các extension quản lý cookie) hoặc nội dung Netscape `cookies.txt`, hoặc chọn file. Giới hạn 5 MB và 10.000 cookie mỗi lần nhập.

Nếu hồ sơ chưa chạy, app tự mở ẩn hồ sơ qua đúng proxy của nó, nhập xong rồi đóng lại. Proxy chết thì app báo lỗi chứ không bao giờ mở trực tiếp không qua proxy. Cookie phiên (không có hạn) chỉ nhập được khi hồ sơ đang chạy, vì đóng nhân là mất; khi hồ sơ chưa chạy, các cookie này bị bỏ qua và được báo trong kết quả.

**Xuất cookie.** Ra một file JSON, bạn tự chọn chỗ lưu. File này chứa phiên đăng nhập, ai có file là vào được tài khoản: hãy giữ như giữ mật khẩu.

**Extension.** Thêm từ thư mục đã giải nén hoặc từ file `.crx` / `.zip` trong "Nhóm, proxy, extension". Gán theo nhóm ngay tại đó, gán riêng cho từng hồ sơ trong form hồ sơ. Thay đổi có hiệu lực từ lần khởi động hồ sơ sau.

App sao chép extension vào thư mục dữ liệu của mình và không kiểm tra chữ ký của file `.crx`, nên chỉ thêm extension từ nguồn bạn tin. File `.crx` giữ nguyên ID gốc của extension, vì vậy dữ liệu (ví dụ ví tiền mã hoá) gắn theo ID không bị đổi.

Giới hạn: chưa tải extension thẳng từ Chrome Web Store, chưa tự cập nhật extension, chưa thử trên Windows.

## API cục bộ, CLI và MCP

**API.** API chạy ngay trong app, nên chỉ hoạt động khi app đang mở, tại `http://127.0.0.1:47800` (chỉ nghe trên máy bạn). Mọi request cần header `Authorization: Bearer <token>`. Token nằm ở file `api-token` trong thư mục dữ liệu của app (nút "Hiện file token" ở cuối cửa sổ). Ai đọc được file này là điều khiển được mọi hồ sơ và lấy được cookie: giữ như mật khẩu. Muốn đổi token, xoá file rồi mở lại app. API cũng từ chối request có `Host` hoặc `Origin` lạ.

| Phương thức và đường dẫn | Việc làm |
|---|---|
| `GET /v1/info` | Trạng thái nhân, phiên bản API |
| `GET /v1/profiles` (`?search=`, `?groupId=` hoặc `none`) | Liệt kê hồ sơ |
| `POST /v1/profiles` | Tạo hồ sơ |
| `GET /v1/profiles/:id` | Xem một hồ sơ |
| `PATCH /v1/profiles/:id` | Sửa hồ sơ |
| `DELETE /v1/profiles/:id` | Xoá hồ sơ (phải dừng trước) |
| `POST /v1/profiles/:id/start` | Khởi động, trả `cdpUrl`; thân `{"headless": true}` để chạy ẩn; đang chạy thì trả phiên hiện có |
| `POST /v1/profiles/:id/stop` | Dừng |
| `GET /v1/profiles/:id/cookies` | Xuất cookie |
| `POST /v1/profiles/:id/cookies` | Nhập cookie (thân `{"text": "..."}` hoặc `{"cookies": [...]}`) |
| `GET /v1/groups`, `GET /v1/proxies` | Liệt kê nhóm, proxy |
| `POST /v1/proxies/:id/check` | Kiểm tra proxy |

```sh
T=$(cat "$HOME/Library/Application Support/Browser Fingerprint/api-token")
curl -s -X POST -H "Authorization: Bearer $T" -H 'Content-Type: application/json' \
  -d '{"headless": true}' http://127.0.0.1:47800/v1/profiles/<mã>/start
# -> {"cdpUrl":"ws://127.0.0.1:.../devtools/browser/...", ...}
```

Nối Playwright vào trình duyệt đó:

```js
const browser = await chromium.connectOverCDP(cdpUrl);
```

**CLI.** Chạy `pnpm run build` một lần, sau đó dùng `pnpm bf <lệnh>` (app phải đang mở):

- `info`, `list`, `show <mã>`, `create <tên>`, `update <mã>`, `delete <mã>`
- `start <mã> [--headless]` (in địa chỉ CDP), `stop <mã>`
- `cookies export <mã> [-o <file>]`, `cookies import <mã> <file>`
- `groups`, `proxies`, `proxy check <mã proxy>`
- `--json` để in JSON, `--help` để xem đầy đủ tuỳ chọn

```sh
CDP=$(pnpm -s bf start <mã> --headless)
```

**MCP.** Cho Claude Code dùng các thao tác trên qua MCP (stdio):

```sh
claude mcp add browser-fingerprint -- node <đường dẫn tuyệt đối tới kho>/packages/api/dist/mcp-main.js
```

12 công cụ: `list_profiles`, `get_profile`, `create_profile`, `update_profile`, `delete_profile`, `start_profile`, `stop_profile`, `import_cookies`, `export_cookies`, `list_groups`, `list_proxies`, `check_proxy`. Cookie đi qua MCP chỉ bằng file (`import_cookies` đọc một file, `export_cookies` ghi một file mới), nội dung cookie không bao giờ nằm trong cuộc trò chuyện. `delete_profile` xoá vĩnh viễn hồ sơ và dữ liệu của nó.

**Biến môi trường.** `BF_API=0` tắt API khi mở app; `BF_API_PORT` đổi cổng (app, CLI và MCP phải dùng cùng cổng); `BF_API_TOKEN_FILE` trỏ CLI và MCP tới file token khác. Nếu cổng đã bị chương trình khác dùng, app vẫn mở bình thường và báo lỗi ở cuối cửa sổ.

Giới hạn: không có HTTPS (chỉ nghe trên 127.0.0.1), một token cho mọi quyền, API không tạo, sửa, xoá nhóm, proxy hay extension, chưa thử trên Windows.

## Giới hạn đã biết

- Nhân là bản dựng của bên thứ ba, mã nguồn bản vá được công bố chậm khoảng một tháng. Không dùng các hồ sơ này cho ví tiền mã hoá giá trị cao.
- Chưa có bộ cài đặt (installer).
- Giai đoạn 2 (tạo hồ sơ hàng loạt, nhập danh sách proxy, kiểm tra proxy, múi giờ và ngôn ngữ theo proxy) đã xây dựng xong. Giai đoạn 3 (nhập và xuất cookie, thư viện extension gán theo nhóm hoặc theo hồ sơ) và giai đoạn 4 (API cục bộ, CLI, MCP) cũng đã xong.

Việc tuân thủ điều khoản dịch vụ của từng nền tảng là trách nhiệm của người dùng.
