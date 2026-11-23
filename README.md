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

## Giới hạn đã biết

- Nhân là bản dựng của bên thứ ba, mã nguồn bản vá được công bố chậm khoảng một tháng. Không dùng các hồ sơ này cho ví tiền mã hoá giá trị cao.
- Chưa có bộ cài đặt (installer).
- Giai đoạn 2 đến 4 chưa được xây dựng.

Việc tuân thủ điều khoản dịch vụ của từng nền tảng là trách nhiệm của người dùng.
