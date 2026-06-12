# MATCHDAY — Lịch bóng đá cá nhân

Web xem lịch thi đấu World Cup 2026 + các giải châu Âu (UCL, UEL, Premier League, La Liga, Serie A, Bundesliga, Ligue 1). Vanilla JS, không build step, không API key.

## Chạy

```bash
./start-server.sh          # mặc định http://localhost:4321
./start-server.sh 8888     # đổi port
```

(Cần serve qua HTTP vì dùng ES modules — mở file trực tiếp sẽ không chạy.)

## Tính năng

- **8 trang lịch độc lập** — mỗi giải một hash route (`#/wc`, `#/ucl`, `#/epl`, …), giữ nguyên ngày/bộ lọc/sort riêng khi switch qua lại.
- **Realtime** — tự poll ESPN mỗi 30s; khi có trận LIVE (hoặc sắp bóng lăn trong 10 phút) tăng tốc lên 7s **kèm cache-buster vượt CDN** (ESPN cache ~7s) nên mọi cú poll đều lấy dữ liệu origin tươi nhất. Tỉ số đổi flash màu accent; timestamp lần cập nhật cuối hiện ở toolbar; tạm dừng khi ẩn tab.
- **Tìm đội thông minh** — gợi ý fuzzy (prefix > word > substring > viết tắt > subsequence), điều hướng phím ↑↓/Enter/Esc; chọn đội → xem **toàn bộ lịch của đội** (7 ngày qua → 45 ngày tới), gom theo ngày. Gõ text thường thì lọc trực tiếp danh sách hiện tại.
- **Xem tất cả** — pill "Tất cả" trên thanh ngày hiện toàn bộ lịch trong cửa sổ thời gian, gom theo ngày. Gõ tìm kiếm cũng tự mở rộng ra toàn bộ lịch (không bị kẹt trong ngày đang chọn).
- **Sort** — giờ đấu ↑/↓, LIVE trước.
- **Chi tiết trận** — logo, tỉ số, phút thi đấu, sân + thành phố, kênh phát sóng, phong độ 5 trận (W/D/L), vòng/bảng đấu.
- **Date strip** — 14 ngày trượt ngang, nút Hôm nay; tab nào có trận LIVE sẽ có chấm đỏ.
- **Responsive mọi thiết bị** — breakpoints 380/480/640/900px, test không tràn ngang từ 320px (iPhone SE cũ) tới tablet/landscape; trên phone chi tiết trận (sân, kênh, bảng) chuyển xuống hàng dưới card thay vì ẩn; safe-area cho máy tai thỏ; input 16px chống iOS auto-zoom; hover chỉ áp dụng cho thiết bị có chuột, touch có hiệu ứng :active riêng.

## Nguồn dữ liệu

ESPN public API (`site.api.espn.com`) — CORS mở, không cần đăng ký. Giờ hiển thị theo timezone máy.

## Cấu trúc

```
index.html              shell + toolbar + containers
css/                    base (tokens/atmosphere), layout, cards, search
js/leagues-config.js    danh sách giải + hằng số polling
js/espn-api.js          fetch + normalize + cache (15s hôm nay / 5ph ngày khác)
js/app-state.js         state riêng từng trang giải
js/match-card-render.js HTML card trận + skeleton/empty/error
js/page-render.js       nav, hero, date strip, render danh sách
js/team-search.js       autocomplete + fuzzy scoring
js/live-polling.js      polling thích ứng + scan LIVE toàn bộ giải
js/app.js               routing + wiring sự kiện
```
