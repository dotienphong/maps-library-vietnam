# Điều khiển máy chủ Ubuntu từ xa (Tailscale)

Máy chủ đặt ở xa, không cùng mạng với máy làm việc. Đường vào là **Tailscale**: một mạng riêng
WireGuard giữa các thiết bị của anh, tự vượt NAT, **không mở cổng nào trên router**.

```
MacBook / Windows ──WireGuard──> mạng riêng Tailscale ──> mapslibvn-server (100.x.y.z)
                                                                  │
                                                          tailscaled tự phục vụ SSH
```

Tailscale chỉ là đường cho **người** vào máy. Postgres và Valhalla **không** đi qua nó: hai dịch vụ
đó vẫn chỉ ra ngoài bằng Tunnel + Access như `README.md` mô tả, và vẫn tuyệt đối không có `ports:`.

> **Đã cân nhắc SSH qua Cloudflare Access và bỏ.** Nó không mở cổng nào và dùng lại hạ tầng sẵn có,
> nhưng phải sinh khoá, cấu hình `~/.ssh/config`, `ssh-copy-id`, và làm lại từng bước đó cho **mỗi**
> máy khách. Tailscale đổi một nhà cung cấp nữa lấy việc bỏ hẳn phần quản khoá. Ghi lại để sau này
> khỏi bàn lại.

## Quy ước đọc

Mỗi lệnh có nhãn nơi gõ: **[UBUNTU]** hoặc **[MÁY KHÁCH]**.

> **Gõ nhầm máy là sự cố thật, không phải cảnh báo lịch sự.** `pnpm server:migrate` tác động lên
> chính máy đang gõ lệnh. Gõ nó trên MacBook là chạy migration lên DB dev của MacBook trong khi
> production không đổi gì — đã xảy ra 19/09/2026. Trước mọi lệnh `server:*`, nhìn prompt: phải là
> `<user>@mapslibvn-server`.

`<user>` là tài khoản Linux trên máy chủ (`whoami` trên máy đó).

---

## Phần A — [UBUNTU] ngồi trước máy, làm một lần (~5 phút)

### A1. Cài Tailscale và bật SSH

```bash
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up --ssh --hostname mapslibvn-server
```

Lệnh thứ hai in ra một URL. Mở nó, đăng nhập bằng tài khoản anh dùng cho Tailscale. Xong:

```bash
tailscale status
tailscale ip -4
```

**Không cần cài `openssh-server`.** Cờ `--ssh` khiến chính `tailscaled` phục vụ SSH, và nó chỉ chiếm
cổng 22 **trên địa chỉ Tailscale** (`100.x.y.z`). Cổng 22 trên IP thường của máy không bị đụng tới,
nên không có gì hở ra mạng LAN hay Internet.

### A2. Tắt hạn khoá — làm ngay, đừng để sau

Admin console Tailscale → **Machines** → `mapslibvn-server` → menu bên phải → **Disable key expiry**.

Mặc định khoá của mỗi máy hết hạn sau **180 ngày**. Hết hạn là máy rớt khỏi mạng riêng, và muốn nối
lại thì **phải gõ lệnh tại chính máy đó** — với máy đặt ở xa, đó là một chuyến đi. Tailscale khuyến
nghị đúng cách này cho máy chủ khó với tới.

Bỏ qua bước này thì mọi thứ vẫn chạy ngon trong nửa năm rồi chết, đúng lúc không ai nhớ vì sao.

### A3. Chặn máy ngủ

Máy chủ là laptop. Đóng nắp là suspend, và lúc đó DB, API lẫn đường vào chết theo — máy ở xa thì
không ai mở nắp hộ. Sự cố tương ứng trên máy chủ Mac đã có trong DEVLOG.

```bash
sudo systemctl mask sleep.target suspend.target hibernate.target hybrid-sleep.target
sudo tee /etc/systemd/logind.conf.d/10-mapslibvn.conf >/dev/null <<'EOF'
HandleLidSwitch=ignore
HandleLidSwitchExternalPower=ignore
HandleLidSwitchDocked=ignore
EOF
sudo systemctl restart systemd-logind
```

Kiểm: `systemctl status sleep.target` → `masked`. Đóng nắp rồi thử `ping` từ máy khác trong cùng
mạng — máy phải còn sống.

### A4. tmux

```bash
sudo apt install -y tmux
```

---

## Phần B — [MÁY KHÁCH] mỗi máy, 2 phút

Cài app và đăng nhập **cùng tài khoản Tailscale**:

```bash
brew install --cask tailscale        # macOS
```

```powershell
winget install --id tailscale.tailscale    # Windows
```

Rồi vào:

```bash
ssh <user>@mapslibvn-server
```

Hết. **Không sinh khoá, không `~/.ssh/config`, không `authorized_keys`, không việc tay trên máy
chủ.** Thêm máy thứ ba, thứ tư sau này cũng đúng hai bước này; phía máy chủ không phải làm gì.

Hai điều xảy ra lần đầu, biết trước khỏi tưởng hỏng:

- **Trình duyệt bật lên bắt xác thực, và lặp lại mỗi 12 giờ.** Đó là `action: "check"` trong chính
  sách mặc định của Tailscale. Muốn khỏi bị hỏi lại thì sửa chính sách trong admin console: đổi
  `"check"` thành `"accept"`, hoặc nới `checkPeriod`. Đổi thì cân nhắc — nó đang là lớp xác thực
  định kỳ cho đường vào máy chủ production.
- **`mapslibvn-server` không phân giải được** nghĩa là MagicDNS chưa bật. Bật trong admin console,
  hoặc dùng thẳng địa chỉ `100.x.y.z` lấy từ `tailscale ip -4`.

Trên Windows, nếu anh làm việc trong WSL2 thì cài Tailscale cho **Windows** là đủ — WSL đi chung
mạng với máy chủ Windows, không phải cài riêng bên trong.

---

## Dùng hàng ngày

### Lệnh vận hành

Gõ từ máy khách, chạy trên máy chủ:

```bash
ssh <user>@mapslibvn-server 'cd ~/maps-library-vietnam && pnpm server:migrate'
ssh <user>@mapslibvn-server 'cd ~/maps-library-vietnam && pnpm server:update'
ssh <user>@mapslibvn-server 'cd ~/maps-library-vietnam && docker compose -f infra/server/compose.yml --env-file infra/server/.env ps'
ssh <user>@mapslibvn-server 'cd ~/maps-library-vietnam && docker compose -f infra/server/compose.yml --env-file infra/server/.env logs --tail 50 postgres cloudflared pipeline valhalla'
ssh <user>@mapslibvn-server 'cd ~/maps-library-vietnam && docker compose -f infra/server/compose.yml --env-file infra/server/.env run --rm pipeline node scripts/routing-graph.mjs status'
```

Thứ tự release có migration không đổi: `server:migrate` **trước**, đối chiếu `/healthz/db` thấy
`schema_migration` đúng bản mới, **rồi** mới push để `Deploy API` chạy (`README.md`, mục Vận hành).

Việc nào chạy lâu (`data:update`, build graph Valhalla) thì **đừng** gõ kiểu một dòng như trên: rớt
mạng là lệnh chết giữa chừng. Dùng tmux ở dưới.

### Chép file

Tailscale SSH có sẵn SFTP nên `scp` dùng được bình thường:

```bash
scp ./file.sql <user>@mapslibvn-server:~/
scp <user>@mapslibvn-server:~/out/report.json ./
```

`rsync` về nguyên tắc chạy được (nó chỉ là một lệnh chạy qua SSH), nhưng tài liệu Tailscale không
nói rõ — **thử một thư mục nhỏ trước** khi tin vào nó cho việc thật.

Đưa file vào container `pipeline`: không có cổng publish, phải chép lên host rồi `docker cp`, sau đó
dựng lại container để nó nhìn thấy:

```bash
scp ./data.pbf <user>@mapslibvn-server:~/
ssh <user>@mapslibvn-server 'cd ~/maps-library-vietnam && \
  docker cp ~/data.pbf $(docker compose -f infra/server/compose.yml --env-file infra/server/.env ps -q pipeline):/app/work/ && \
  docker compose -f infra/server/compose.yml --env-file infra/server/.env up -d --force-recreate pipeline'
```

### tmux — cho việc chạy lâu

```bash
ssh <user>@mapslibvn-server
tmux new -s ops                 # tạo phiên tên "ops"
# ... chạy pnpm data:update, build graph, gì cũng được ...
# Ctrl+b rồi d                  → rời phiên, việc vẫn chạy tiếp
exit                            # đóng SSH thoải mái
```

Quay lại xem:

```bash
ssh <user>@mapslibvn-server -t 'tmux attach -t ops'
```

`tmux ls` liệt kê các phiên đang có. Rớt mạng giữa chừng không sao — việc chạy trong tmux không chết
theo phiên SSH.

---

## Khi không vào được

Chẩn đoán theo thứ tự này, đừng nhảy cóc:

1. **Máy khách còn trong mạng riêng không**: `tailscale status`. Chưa đăng nhập hoặc app chưa chạy
   là lỗi hay gặp nhất và vô hại.
2. **Hết hạn xác thực định kỳ** (`action: "check"`, 12 giờ): lần `ssh` sau tự mở trình duyệt. Trình
   duyệt không tự mở thì `tailscale status` in ra URL.
3. **Máy chủ có online trong admin console không.** Hiện `Expired` nghĩa là Phần A2 chưa làm — và
   đây là lúc nó thành chuyến đi. Hiện offline nghĩa là máy mất điện hoặc mất mạng.
4. **Khoá node hết hạn**: xem lại A2.

Cả bốn bước đều không ra thì phải có người ngồi trước máy. Đó là giới hạn cố hữu của máy đặt ở xa —
không có cách nào từ xa cứu một máy đã tắt.

## Bảo trì

- **Cập nhật**: `sudo tailscale update` trên máy chủ (hoặc `apt upgrade tailscale`). Không liên quan
  tới `cloudflared` trong compose.
- **Mất một máy khách**: admin console → Machines → xoá đúng node đó. Các máy còn lại không ảnh
  hưởng, không phải đổi gì trên máy chủ.
- **Tài khoản Tailscale giờ là chìa khoá vào máy chủ production.** Bật 2FA cho nó. Ai đăng nhập được
  tài khoản đó là vào được máy chủ, không cần khoá SSH nào cả — đó vừa là cái tiện vừa là cái rủi ro
  của cách này.
- **Không có cảnh báo khi máy chủ rớt mạng riêng.** Notification `tunnel_health_event` đã tạo
  (`README.md` mục 5) chỉ theo dõi tunnel `mapslibvn-db`. Nó vẫn là tín hiệu gián tiếp tốt: máy chủ
  chết thì tunnel cũng down và anh nhận được mail.
