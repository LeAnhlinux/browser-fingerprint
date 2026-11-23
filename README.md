# Browser Fingerprint

Trình quản lý hồ sơ trình duyệt tách biệt (antidetect) dùng cá nhân, chạy hoàn toàn trên máy bạn. Mỗi hồ sơ có thư mục dữ liệu riêng, seed dấu vân tay riêng và proxy riêng (tuỳ chọn). Đây là giai đoạn 1 của thiết kế trong `docs/superpowers/specs/2026-11-23-antidetect-browser-design.md`.

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
pnpm test                              # kiểm thử đơn vị của packages/core
pnpm --filter @bf/core test:engine     # dùng nhân thật, mở cửa sổ trình duyệt thật trong vài giây
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

## Giới hạn đã biết

- Nhân là bản dựng của bên thứ ba, mã nguồn bản vá được công bố chậm khoảng một tháng. Không dùng các hồ sơ này cho ví tiền mã hoá giá trị cao.
- Chưa có bộ cài đặt (installer).
- Giai đoạn 2 (tạo hồ sơ hàng loạt, nhập danh sách proxy, kiểm tra proxy, múi giờ và ngôn ngữ theo proxy) đã xây dựng xong. Giai đoạn 3 (nhập và xuất cookie, thư viện extension gán theo nhóm hoặc theo hồ sơ) cũng đã xong; còn giai đoạn 4 chưa được xây dựng.

Việc tuân thủ điều khoản dịch vụ của từng nền tảng là trách nhiệm của người dùng.
