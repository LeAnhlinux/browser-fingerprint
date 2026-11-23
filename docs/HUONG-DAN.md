# Hướng dẫn sử dụng Browser Fingerprint

Browser Fingerprint quản lý nhiều **hồ sơ trình duyệt** tách biệt trên một máy. Mỗi hồ sơ là một trình duyệt Chromium riêng với:

- **dấu vân tay riêng** (canvas, WebGL, âm thanh, phần cứng…), cố định cho hồ sơ đó;
- **proxy riêng**, nên mỗi hồ sơ ra Internet bằng một IP khác;
- **cookie, phiên đăng nhập, extension riêng**, không lẫn sang hồ sơ khác.

Đăng nhập một lần thì lần sau mở hồ sơ vẫn còn đăng nhập.

![Màn hình chính](huong-dan/01-ho-so.png)

## Mục lục

1. [Cài đặt và lần mở đầu tiên](#1-cài-đặt-và-lần-mở-đầu-tiên)
2. [Làm quen với giao diện](#2-làm-quen-với-giao-diện)
3. [Thêm proxy](#3-thêm-proxy)
4. [Tạo hồ sơ](#4-tạo-hồ-sơ)
5. [Khởi động và dừng hồ sơ](#5-khởi-động-và-dừng-hồ-sơ)
6. [Làm việc với nhiều hồ sơ một lúc](#6-làm-việc-với-nhiều-hồ-sơ-một-lúc)
7. [Nhóm](#7-nhóm)
8. [Nhập và xuất cookie](#8-nhập-và-xuất-cookie)
9. [Extension (ví crypto và các extension khác)](#9-extension-ví-crypto-và-các-extension-khác)
10. [Tự động hoá: Playwright, lệnh bf, trợ lý AI](#10-tự-động-hoá-playwright-lệnh-bf-trợ-lý-ai)
11. [Mẹo để không bị lộ](#11-mẹo-để-không-bị-lộ)
12. [Dữ liệu nằm ở đâu, sao lưu thế nào](#12-dữ-liệu-nằm-ở-đâu-sao-lưu-thế-nào)
13. [Câu hỏi thường gặp](#13-câu-hỏi-thường-gặp)

---

## 1. Cài đặt và lần mở đầu tiên

**macOS (chỉ Mac chip Apple: M1, M2, M3, M4…).** Mở file `Browser-Fingerprint-<phiên bản>-arm64.dmg` và kéo app vào thư mục Applications.

- App không có chữ ký số của Apple. File dmg bạn tự build trên máy mình thì mở được ngay.
- Nếu chép sang máy khác, lần đầu macOS sẽ chặn. Bấm chuột phải vào app > **Mở** > **Mở**, hoặc vào **Cài đặt hệ thống > Quyền riêng tư và bảo mật** và bấm **Vẫn mở**.

**Windows (64-bit).** Chạy `Browser-Fingerprint-<phiên bản>-x64-setup.exe`. Bộ cài cài cho tài khoản Windows hiện tại (không cần quyền quản trị) và tạo lối tắt ngoài màn hình.

- SmartScreen sẽ cảnh báo vì không có chữ ký số: bấm **Thông tin thêm** > **Vẫn chạy**.
- Bản Windows chưa được chạy thử trên máy Windows thật. Nếu gặp lỗi, ghi lại thông báo lỗi.

**Lần mở đầu tiên**, app cần tải **nhân trình duyệt**: bản Chromium đã vá dấu vân tay, khoảng 140–190 MB. Bấm **Tải và cài nhân** và chờ thanh tiến trình chạy hết. File được tải từ GitHub và kiểm tra SHA-256 trước khi cài. Chỉ cần làm một lần.

## 2. Làm quen với giao diện

Thanh bên trái có năm trang:

| Trang | Dùng để |
|---|---|
| **Hồ sơ** | Xem, tạo, sửa, khởi động, dừng hồ sơ. Số màu xanh bên cạnh là số hồ sơ đang chạy. |
| **Proxy** | Thêm proxy, kiểm tra proxy còn sống không và ra IP, quốc gia nào. |
| **Nhóm** | Chia hồ sơ theo việc: Instagram, Facebook, Airdrop… |
| **Extension** | Thư viện extension dùng chung, gán cho hồ sơ hoặc cả nhóm. |
| **Cài đặt** | Phiên bản nhân, trạng thái API cục bộ, file token. |

Góc dưới thanh bên cho biết API cục bộ có đang chạy không và phiên bản nhân.

Giao diện sáng hay tối tự theo cài đặt của máy.

![Nền tối](huong-dan/13-nen-toi.png)

## 3. Thêm proxy

Nên thêm proxy trước rồi mới tạo hồ sơ. Vào trang **Proxy** > **Thêm proxy**.

**Thêm từng proxy**, tab **Một proxy**: chọn giao thức (HTTP hoặc SOCKS5), nhập địa chỉ, cổng, và tài khoản, mật khẩu nếu có.

![Thêm một proxy](huong-dan/08-them-proxy.png)

**Thêm cả danh sách**, tab **Dán danh sách**: dán mỗi dòng một proxy. App nhận các dạng:

```
socks5://user:pass@1.2.3.4:1080
user:pass@5.6.7.8:8080
5.6.7.8:8080:user:pass
9.9.9.9:3128
```

- Dòng không ghi giao thức dùng giao thức chọn ở ô bên dưới.
- Dòng trống, dòng bắt đầu bằng `#`, và proxy đã có sẵn đều bị bỏ qua.
- Dòng sai được báo theo số dòng để bạn sửa; các dòng đúng vẫn được thêm.
- Dòng hiểu được theo hai cách (ví dụ mật khẩu có ký tự `@`) bị từ chối thay vì đoán. Khi đó hãy viết lại dòng đó ở dạng `giao_thức://user:pass@host:port`.

![Dán danh sách proxy](huong-dan/09-dan-danh-sach.png)

**Kiểm tra proxy.** Bấm nút ↻ trên từng dòng, hoặc **Kiểm tra tất cả**. Proxy sống hiện chấm xanh kèm IP, quốc gia, múi giờ; proxy chết hiện chấm đỏ kèm lý do.

![Danh sách proxy](huong-dan/07-proxy.png)

- Kiểm tra gửi đúng một request tới dịch vụ tra IP (ip-api.com) **qua chính proxy đó**.
- Dịch vụ này giới hạn khoảng 45 lần mỗi phút. Với danh sách vài chục proxy, một số dòng có thể báo "giới hạn tốc độ": chờ một phút rồi kiểm tra lại những dòng đó.
- Mật khẩu proxy được mã hoá bằng kho khoá của hệ điều hành (Keychain trên Mac) và không bao giờ hiện lại trên giao diện.

## 4. Tạo hồ sơ

Trang **Hồ sơ** > **Hồ sơ mới**. Bảng bên phải gồm ba phần.

![Tạo hồ sơ mới](huong-dan/02-ho-so-moi.png)

**Cơ bản**
- **Tên:** đặt sao cho dễ nhận ra, ví dụ `IG-US-01`.
- **Nhóm:** không bắt buộc.
- **Ghi chú:** tài khoản, việc cần làm… Dòng đầu của ghi chú hiện dưới tên hồ sơ trong danh sách.

**Mạng**
- **Proxy:** chọn trong danh sách proxy đã thêm. Chọn "Không dùng" thì hồ sơ đi thẳng bằng IP thật của bạn.
- **Múi giờ:** nên khớp với vùng của proxy. Nếu proxy đã kiểm tra thành công, app hiện nút **Dùng múi giờ của proxy** để điền đúng chỉ bằng một cú bấm.
- **Ngôn ngữ** và **Accept-Language:** nên khớp với quốc gia của proxy, ví dụ proxy Mỹ thì `en-US` và `en-US,en`.

**Dấu vân tay**
- **Hệ điều hành giả:** để mặc định là hệ điều hành thật của máy. Giả hệ điều hành khác dễ lộ qua font và card đồ hoạ; app cảnh báo nếu bạn đổi.
- **Số nhân CPU:** bỏ trống để nhân trình duyệt tự chọn.
- **Màn hình:** chọn một độ phân giải phổ biến cho hệ điều hành giả, hoặc **Tự nhập…** (rộng, cao, tỉ lệ điểm ảnh). Để "Màn hình thật của máy" thì trang web thấy đúng màn hình của bạn, vốn là một chỗ dễ lộ (ví dụ máy Mac giả làm Windows mà màn hình lại là của MacBook).
  - Khi giả màn hình, hồ sơ đó tắt tính năng cách ly trang theo tên miền của Chromium, nên kém an toàn hơn một chút trước trang độc hại.
  - Cửa sổ trình duyệt mở vừa trong màn hình giả. Đừng kéo cửa sổ to hơn màn hình giả (ví dụ phóng to toàn màn hình trên màn 4K), vì trang sẽ thấy cửa sổ to hơn cả màn hình.
- **GPU, RAM, nhiễu canvas, âm thanh, font:** nhân trình duyệt tự chọn theo **seed** của hồ sơ (một mã ngẫu nhiên sinh khi tạo). Seed giữ nguyên nên trang web thấy cùng một "máy" mỗi lần bạn mở hồ sơ. Không gõ tay tên GPU được: bản nhân hiện tại đã bỏ tuỳ chọn này.

**Xem trang web sẽ thấy gì.** Mở một hồ sơ đã tạo: ô **Trang web sẽ thấy** trong phần Dấu vân tay hiện GPU, số nhân CPU, RAM, màn hình, hệ điều hành, múi giờ, ngôn ngữ và User-Agent. App mở ẩn nhân trong vài giây để đo thật, không đụng dữ liệu của hồ sơ, nên đo được cả khi hồ sơ đang chạy. Tên GPU cũng hiện dưới tên hồ sơ trong danh sách.

- **Đo lại:** đo theo thiết lập đã lưu (sửa xong nhớ bấm Lưu trước).
- **Đổi vân tay:** tạo seed mới, nên GPU, CPU, RAM và các nhiễu đều đổi, rồi đo lại ngay. Bấm đến khi ra cấu hình ưng ý. Với hồ sơ đã đăng nhập tài khoản, đổi vân tay giống như đăng nhập từ một máy khác, nên app hỏi lại trước khi đổi.

**Extension:** nếu thư viện có extension, tick những cái muốn nạp cho hồ sơ này.

Bấm **Tạo hồ sơ**.

**Sửa hồ sơ:** bấm vào dòng hồ sơ trong danh sách để mở bảng chi tiết, sửa, rồi bấm **Lưu thay đổi**. Thay đổi proxy, dấu vân tay hay extension của hồ sơ đang chạy có hiệu lực từ lần khởi động sau.

![Bảng chi tiết hồ sơ](huong-dan/03-chi-tiet.png)

**Xoá hồ sơ:** trong bảng chi tiết, bấm **Xoá hồ sơ**. Toàn bộ dữ liệu trình duyệt của hồ sơ (cookie, phiên đăng nhập, dữ liệu ví) bị xoá theo và không khôi phục được. Hồ sơ đang chạy phải dừng trước.

## 5. Khởi động và dừng hồ sơ

Bấm nút ▷ ở cuối dòng để khởi động; nút chuyển thành ▢ để dừng. Trong bảng chi tiết cũng có nút **Khởi động** / **Dừng**.

Cột **Trạng thái** cho biết:

| Trạng thái | Nghĩa |
|---|---|
| ● Sẵn sàng | Hồ sơ đang tắt. |
| ● Đang chạy | Cửa sổ trình duyệt của hồ sơ đang mở. |
| ● Đang chạy ẩn | Hồ sơ đang chạy không có cửa sổ, thường do app tạm mở để nhập hay xuất cookie, hoặc do một script chạy ẩn. |

- Đóng cửa sổ cuối cùng của hồ sơ (hoặc tab cuối cùng) cũng là dừng hồ sơ, trên cả macOS lẫn Windows. Trên macOS app mất khoảng 2 giây để nhận ra rồi tự dừng.
- **Proxy chết thì hồ sơ không mở**, và app báo proxy nào không kết nối được. App không bao giờ tự chuyển sang kết nối trực tiếp, để IP thật của bạn không bị lộ.
- Mỗi hồ sơ chỉ mở được một lần một lúc. Nhiều hồ sơ khác nhau thì mở cùng lúc thoải mái.
- Thoát app sẽ dừng mọi hồ sơ đang chạy.

## 6. Làm việc với nhiều hồ sơ một lúc

**Tạo hàng loạt.** Bấm **Tạo hàng loạt** ở trang Hồ sơ.

![Tạo hàng loạt](huong-dan/06-tao-hang-loat.png)

- **Mẫu tên:** `{n}` được thay bằng số thứ tự. Ví dụ `AMZ-US-{n}` với số lượng 10 cho `AMZ-US-01` … `AMZ-US-10`. Không có `{n}` thì số được nối vào cuối tên.
- **Gán lần lượt các proxy chưa dùng:** mỗi hồ sơ mới nhận một proxy chưa hồ sơ nào dùng. Nếu không đủ proxy thì app không tạo hồ sơ nào và báo cần bao nhiêu, đang có bao nhiêu.
- **Đặt múi giờ và ngôn ngữ theo proxy:** cần kiểm tra proxy trước (trang Proxy > **Kiểm tra tất cả**).
- Tối đa 500 hồ sơ một lần.

**Sửa nhiều hồ sơ cùng lúc.** Tick ô vuông đầu các dòng (ô ở tiêu đề bảng chọn tất cả). Thanh thao tác hiện ở đáy màn hình:

![Thanh thao tác hàng loạt](huong-dan/05-hang-loat.png)

| Nút | Việc làm |
|---|---|
| **Gán nhóm** | Chuyển các hồ sơ đã chọn vào nhóm ở ô bên cạnh. |
| **Gán proxy** | Cho mọi hồ sơ đã chọn dùng proxy ở ô bên cạnh. Chọn "Không dùng proxy" sẽ hỏi lại vì hồ sơ sẽ đi bằng IP thật. |
| **Gán proxy chưa dùng** | Mỗi hồ sơ nhận một proxy chưa ai dùng. App hỏi lại nếu có hồ sơ đang có proxy. |
| **Múi giờ theo proxy** | Đặt múi giờ, ngôn ngữ của từng hồ sơ theo kết quả kiểm tra proxy của nó. Hồ sơ không có proxy, hoặc proxy chưa kiểm tra, được bỏ qua và liệt kê lại. |

Bấm ✕ ở đầu thanh để bỏ chọn.

## 7. Nhóm

Trang **Nhóm**: gõ tên, bấm **Thêm nhóm**. Bút chì để đổi tên, thùng rác để xoá.

![Nhóm](huong-dan/10-nhom.png)

- Xoá nhóm **không xoá hồ sơ**, chỉ chuyển chúng về "Chưa gán nhóm".
- Ở trang Hồ sơ, ô **Tất cả nhóm** cạnh ô tìm kiếm lọc danh sách theo nhóm.

## 8. Nhập và xuất cookie

Mở bảng chi tiết của hồ sơ > tab **Cookie**.

![Cookie](huong-dan/04-cookie.png)

**Nhập.** Dán nội dung cookie vào ô, hoặc bấm **Chọn file .json hoặc .txt…**, rồi bấm **Nhập cookie**.

- App nhận JSON (kiểu xuất của các extension cookie như Cookie-Editor, EditThisCookie) và Netscape `cookies.txt`.
- Mục sai được báo theo số thứ tự; mục đúng vẫn được nhập.
- **Hồ sơ đang tắt:** app tự mở ẩn hồ sơ, vẫn qua proxy của nó, nhập xong rồi đóng. Proxy chết thì báo lỗi, không nhập qua IP thật.
- **Cookie phiên** (không có hạn) chỉ nhập được khi hồ sơ đang chạy, vì chúng mất ngay khi đóng trình duyệt. Muốn nhập cả loại này thì khởi động hồ sơ trước.
- Giới hạn 5 MB và 10.000 cookie mỗi lần.

**Xuất.** Bấm **Xuất ra file JSON…** và chọn chỗ lưu. File nhập lại được vào hồ sơ khác bằng chính app.

> File cookie chứa **phiên đăng nhập**: ai có file là vào được tài khoản mà không cần mật khẩu. Giữ nó như giữ mật khẩu, đừng gửi qua chat hay để trong thư mục đồng bộ công khai.

## 9. Extension (ví crypto và các extension khác)

Trang **Extension** là thư viện dùng chung.

![Extension](huong-dan/11-extension.png)

**Thêm extension:**
- **Thêm file .crx/.zip…** cho file bạn tải về. File `.crx` giữ đúng ID gốc như trên Chrome Web Store, nên dữ liệu ví gắn theo ID không đổi.
- **Thêm từ thư mục…** cho extension đã giải nén.
- App sao chép extension vào thư mục dữ liệu của nó. Sửa thư mục gốc sau đó không có tác dụng; muốn cập nhật thì xoá rồi thêm lại.
- App chưa tải được extension thẳng từ Chrome Web Store: bạn tự tải file `.crx` hoặc `.zip` về.

**Gán extension:**
- Cho **một hồ sơ:** trong bảng chi tiết của hồ sơ, tick extension ở phần **Extension**.
- Cho **cả nhóm:** ở cuối trang Extension, tick theo từng nhóm. Mọi hồ sơ trong nhóm đều nạp extension đó; trong bảng chi tiết hồ sơ chúng hiện dạng đã tick kèm chữ "từ nhóm".
- Thay đổi có hiệu lực từ lần khởi động sau của hồ sơ.

> App không kiểm chữ ký của file `.crx`. Chỉ thêm extension từ nguồn bạn tin, nhất là extension ví.

## 10. Tự động hoá: Playwright, lệnh bf, trợ lý AI

Khi app đang mở, nó chạy một **API cục bộ** tại `http://127.0.0.1:47800`, chỉ máy bạn gọi được. Trang **Cài đặt** cho biết địa chỉ và có nút **Hiện file token**.

![Cài đặt](huong-dan/12-cai-dat.png)

Ba cách dùng:

- **Playwright / Puppeteer:** khởi động hồ sơ qua API để lấy địa chỉ CDP (`ws://127.0.0.1:…`), rồi nối vào bằng `chromium.connectOverCDP(địa_chỉ)`.
- **Lệnh `bf`** trong Terminal. Ví dụ `pnpm bf list` để liệt kê hồ sơ, hoặc `pnpm bf start <mã> --headless` để chạy ẩn và in địa chỉ CDP.
- **Trợ lý AI** (Claude Code và các trợ lý hỗ trợ MCP): 12 công cụ để tạo, khởi động, dừng hồ sơ và nhập, xuất cookie.

Cách cài và ví dụ đầy đủ nằm trong [README](../README.md), mục "API cục bộ, CLI và MCP".

Lưu ý an toàn:
- **File token tương đương mật khẩu:** ai đọc được nó là điều khiển được mọi hồ sơ và lấy được cookie. Xoá file rồi mở lại app để đổi token.
- **Địa chỉ CDP của hồ sơ đang chạy không có mật khẩu:** chương trình nào trên máy cũng nối vào được trong lúc hồ sơ chạy.
- **Chỉ gắn MCP vào trợ lý AI bạn tin:** nó xoá được hồ sơ và gỡ được proxy.

## 11. Mẹo để không bị lộ

- **Một hồ sơ, một proxy.** Đừng cho hai tài khoản cùng nền tảng dùng chung proxy.
- **Múi giờ và ngôn ngữ khớp với proxy.** Proxy Nhật mà múi giờ Việt Nam là dấu hiệu bất thường. Dùng nút "Dùng múi giờ của proxy", hoặc "Múi giờ theo proxy" khi sửa hàng loạt.
- **Kiểm tra proxy trước khi dùng**, nhất là proxy mua theo lô.
- **Để hệ điều hành giả trùng máy thật.**
- **Kiểm tra lại dấu vân tay:** mở một hồ sơ, vào các trang như browserleaks.com hoặc creepjs, xem IP, múi giờ, WebRTC có khớp proxy không.
- **Không đăng nhập cùng một tài khoản ở hai hồ sơ.**
- **Không dùng hồ sơ cho ví crypto giá trị lớn.** Nhân trình duyệt là bản build của bên thứ ba.

Nhiều nền tảng cấm dùng nhiều tài khoản trong điều khoản dịch vụ; việc tuân thủ là trách nhiệm của bạn.

## 12. Dữ liệu nằm ở đâu, sao lưu thế nào

Mọi thứ (danh sách hồ sơ, proxy, dữ liệu trình duyệt từng hồ sơ, extension, nhân) nằm trong:

- **macOS:** `~/Library/Application Support/Browser Fingerprint`
- **Windows:** `%APPDATA%\Browser Fingerprint`

Sao lưu: **thoát app** rồi chép cả thư mục này.

- Mật khẩu proxy được mã hoá bằng kho khoá của chính máy đó. Chép sang máy khác thì phải nhập lại mật khẩu proxy.
- Gỡ app không xoá thư mục này. Muốn xoá sạch thì xoá thư mục bằng tay.

## 13. Câu hỏi thường gặp

**Bấm khởi động thì báo "Proxy … không kết nối được".**
Proxy đang chết hoặc sai địa chỉ, tài khoản. Vào trang Proxy bấm kiểm tra để xem lý do, rồi đổi proxy cho hồ sơ.

**Kiểm tra proxy báo "giới hạn tốc độ".**
Dịch vụ tra IP giới hạn khoảng 45 lần mỗi phút. Chờ một phút rồi kiểm tra lại những proxy đó.

**Nhập cookie xong vẫn không đăng nhập được.**
Thường do cookie phiên bị bỏ qua vì hồ sơ đang tắt. Khởi động hồ sơ rồi nhập lại. Cũng có thể trang web gắn phiên đăng nhập với IP: dùng proxy cùng vùng với nơi cookie được lấy.

**Extension không hiện trong hồ sơ.**
Extension chỉ nạp khi khởi động. Dừng hồ sơ rồi khởi động lại.

**Một hồ sơ hiện "Đang chạy ẩn" mà tôi không mở.**
App đang tạm mở hồ sơ đó để nhập hoặc xuất cookie, hoặc một script đã khởi động nó qua API. Bấm dừng nếu cần.

**Tôi chạy cả bản cài và bản `pnpm dev`.**
Hai bản dùng chung một thư mục dữ liệu. Chỉ mở một bản mỗi lúc.

**Thanh bên ghi "API lỗi".**
Thường do cổng 47800 đang bị chương trình khác dùng (ví dụ đang mở hai app). Trang Cài đặt ghi lý do cụ thể. App vẫn dùng bình thường, chỉ API không chạy.
