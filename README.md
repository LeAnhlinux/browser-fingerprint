# Browser Fingerprint

Trình quản lý hồ sơ trình duyệt tách biệt (antidetect) dùng cá nhân, chạy hoàn toàn trên máy bạn. Mỗi hồ sơ có thư mục dữ liệu riêng, seed dấu vân tay riêng và proxy riêng (tuỳ chọn). Thiết kế (cả bốn giai đoạn đã xây xong) nằm trong `docs/superpowers/specs/2026-11-23-antidetect-browser-design.md`.

**Người dùng: đọc [Hướng dẫn sử dụng](docs/HUONG-DAN.md)** (có ảnh chụp từng màn hình). README này dành cho việc build, chạy từ mã nguồn và lập trình với API.

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

## Đóng gói bộ cài

Cả hai lệnh chạy được trên Mac; file ra nằm ở `packages/app/dist/`.

```sh
pnpm dist:mac   # Browser-Fingerprint-<phiên bản>-arm64.dmg (chỉ Mac chip Apple)
pnpm dist:win   # Browser-Fingerprint-<phiên bản>-x64-setup.exe
```

- Bộ cài không chứa nhân trình duyệt: app tải nhân ở lần mở đầu tiên, như khi chạy bằng `pnpm dev`. Bộ cài Mac chỉ có bản cho chip Apple vì nhân macOS chỉ phát hành bản arm64.
- App đã cài dùng chung thư mục dữ liệu với `pnpm dev` (trên Mac là `~/Library/Application Support/Browser Fingerprint`), nên hồ sơ tạo ở bản nào cũng thấy ở bản kia. Đừng mở cả hai cùng lúc.
- Bộ cài không có chữ ký số. Trên Mac, file dmg bạn tự build trên máy mình mở được ngay; nếu chép sang máy khác, lần đầu bấm chuột phải vào app > Mở, hoặc vào Cài đặt hệ thống > Quyền riêng tư và bảo mật > Vẫn mở. Trên Windows, SmartScreen sẽ cảnh báo: bấm "Thông tin thêm" > "Vẫn chạy".
- Bộ cài Windows cài cho người dùng hiện tại (không cần quyền quản trị) và tạo lối tắt ngoài màn hình.
- Lệnh `bf` và MCP server không nằm trong bộ cài: vẫn chạy từ thư mục kho như mục "API cục bộ, CLI và MCP" bên dưới, và nói chuyện được với app đã cài.

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
| `POST /v1/profiles/:id/fingerprint/measure` | Đo những gì trang web thấy (GPU, CPU, RAM, User-Agent…), mở ẩn nhân vài giây |
| `POST /v1/profiles/:id/fingerprint/regenerate` | Đổi seed: GPU, CPU, RAM và các nhiễu đổi theo |
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
- `cookies export <mã> [-o <file>]`, `cookies import <mã> <file>`. Không có `-o`, `cookies export` in phiên đăng nhập (cookie) ra terminal; nên dùng `-o` (file chỉ chủ máy đọc được, quyền 0600)
- `groups`, `proxies`, `proxy check <mã proxy>`
- `--json` để in JSON, `--help` để xem đầy đủ tuỳ chọn

```sh
CDP=$(pnpm -s bf start <mã> --headless)
```

**MCP.** Cho Claude Code dùng các thao tác trên qua MCP (stdio):

```sh
claude mcp add browser-fingerprint -- node <đường dẫn tuyệt đối tới kho>/packages/api/dist/mcp-main.js
```

12 công cụ: `list_profiles`, `get_profile`, `create_profile`, `update_profile`, `delete_profile`, `start_profile`, `stop_profile`, `import_cookies`, `export_cookies`, `list_groups`, `list_proxies`, `check_proxy`. `delete_profile` xoá vĩnh viễn hồ sơ và dữ liệu của nó; `update_profile` đổi được cả `proxyId`. Cả hai nằm trong tầm tay của trợ lý nào bạn gắn MCP vào.

Về cookie và độ tin cậy: kết quả của công cụ MCP không bao giờ chứa giá trị cookie. Nhưng `cdpUrl` (do `list_profiles`, `get_profile`, `start_profile` trả về) cho phép ai cầm nó điều khiển hoàn toàn trình duyệt của hồ sơ đó và đọc cookie của nó, nên chỉ gắn MCP server này vào trợ lý bạn tin tưởng. Địa chỉ CDP của một hồ sơ đang chạy không có xác thực: mọi tiến trình trên máy đều nối được vào nó trong lúc hồ sơ chạy (điều này đúng từ giai đoạn 1, dù có dùng API hay không).

**Thư mục file của MCP.** `import_cookies` và `export_cookies` chỉ đọc và ghi trong một thư mục duy nhất, mặc định là `mcp-files` cạnh file token (ví dụ `~/Library/Application Support/Browser Fingerprint/mcp-files` trên macOS); đặt `BF_MCP_FILE_DIR` (đường dẫn tuyệt đối) để dùng thư mục khác. Thư mục được tạo khi dùng lần đầu với quyền 0700. Hai công cụ nhận một tên file (`fileName`: 1 đến 100 ký tự gồm chữ, số, `.`, `-`, `_`, không bắt đầu hoặc kết thúc bằng dấu chấm), không nhận đường dẫn. `export_cookies` tạo file mới (0600) và không bao giờ ghi đè; `import_cookies` không đọc file là liên kết (symlink). Muốn nhập một file cookie qua MCP, bạn tự chép file vào thư mục này trước rồi đưa tên file cho trợ lý.

**Biến môi trường.** `BF_API=0` tắt API khi mở app; `BF_API_PORT` đổi cổng (app, CLI và MCP phải dùng cùng cổng); `BF_API_TOKEN_FILE` trỏ CLI và MCP tới file token khác; `BF_MCP_FILE_DIR` đổi thư mục file của MCP. Nếu cổng đã bị chương trình khác dùng, app vẫn mở bình thường và báo lỗi ở cuối cửa sổ.

Giới hạn: không có HTTPS (chỉ nghe trên 127.0.0.1), một token cho mọi quyền, API không tạo, sửa, xoá nhóm, proxy hay extension, chưa thử trên Windows.

## Giới hạn đã biết

- Nhân là bản dựng của bên thứ ba, mã nguồn bản vá được công bố chậm khoảng một tháng. Không dùng các hồ sơ này cho ví tiền mã hoá giá trị cao.
- Bộ cài Windows build được nhưng chưa từng được chạy thử trên máy Windows; phần riêng của Windows trong app (giải nén nhân, dọn tiến trình sót) cũng vậy.
- Giai đoạn 2 (tạo hồ sơ hàng loạt, nhập danh sách proxy, kiểm tra proxy, múi giờ và ngôn ngữ theo proxy) đã xây dựng xong. Giai đoạn 3 (nhập và xuất cookie, thư viện extension gán theo nhóm hoặc theo hồ sơ) và giai đoạn 4 (API cục bộ, CLI, MCP) cũng đã xong.

Việc tuân thủ điều khoản dịch vụ của từng nền tảng là trách nhiệm của người dùng.
