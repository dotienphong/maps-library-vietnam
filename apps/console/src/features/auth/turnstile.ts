import { useCallback, useEffect, useRef, useState } from 'react';

declare global {
  interface Window {
    // `| undefined` là bắt buộc dưới `exactOptionalPropertyTypes`: bài kiểm phải gán lại được
    // `undefined` để dựng cảnh "script chưa tải xong".
    turnstile?:
      | {
          render(el: HTMLElement, opts: Record<string, unknown>): string | undefined;
          reset(id?: string): void;
          remove(id: string): void;
        }
      | undefined;
  }
}

const NGUON = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** Nạp script một lần cho cả ứng dụng, kể cả khi hai trang cùng dựng widget. */
function napScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  const daCo = document.querySelector<HTMLScriptElement>(`script[src="${NGUON}"]`);
  if (daCo) {
    return new Promise((xong, hong) => {
      daCo.addEventListener('load', () => xong(), { once: true });
      daCo.addEventListener('error', () => hong(new Error('turnstile_script_failed')), {
        once: true,
      });
    });
  }
  return new Promise((xong, hong) => {
    const script = document.createElement('script');
    script.src = NGUON;
    script.async = true;
    script.addEventListener('load', () => xong(), { once: true });
    script.addEventListener('error', () => hong(new Error('turnstile_script_failed')), {
      once: true,
    });
    document.head.append(script);
  });
}

export interface Turnstile {
  /** Gắn vào một `<div>` rỗng, widget dựng vào đó. */
  oWidget: React.RefObject<HTMLDivElement | null>;
  token: string;
  /**
   * Máy chủ có đòi chống bot mà widget chưa trả token. Nút gửi PHẢI khoá theo cờ này: gửi lúc
   * token còn rỗng thì máy chủ trả 403 `turnstile_failed`, và người thật đọc được câu "bạn không
   * qua được bước chống robot". Ngoài production máy chủ bỏ qua bước kiểm nên site key rỗng và
   * cờ này luôn false, không chặn nhầm môi trường phát triển.
   */
  dangCho: boolean;
  /** Xin token mới. Token của Turnstile dùng được đúng một lần ở phía máy chủ. */
  datLai(): void;
}

export function useTurnstile(siteKey: string | undefined): Turnstile {
  const oWidget = useRef<HTMLDivElement>(null);
  const idWidget = useRef<string | null>(null);
  const [token, datToken] = useState('');

  useEffect(() => {
    if (!siteKey) return;
    let daHuy = false;
    napScript()
      .then(() => {
        // StrictMode chạy effect hai lần; thiếu chốt này thì trang có hai widget chồng nhau và
        // cái thứ hai ghi đè callback của cái đầu.
        if (daHuy || !oWidget.current || idWidget.current !== null) return;
        idWidget.current =
          window.turnstile?.render(oWidget.current, {
            sitekey: siteKey,
            callback: (t: string) => datToken(t),
            // Token sống 300 giây. Trang đăng nhập mở lâu rồi mới bấm là chuyện thường, và nếu
            // không xoá token hết hạn thì máy chủ từ chối mà người dùng không hiểu vì sao.
            'expired-callback': () => datToken(''),
            'timeout-callback': () => datToken(''),
            'error-callback': () => datToken(''),
          }) ?? null;
      })
      .catch(() => {
        // Script không tải được thì để `dangCho` giữ nút khoá; người dùng thấy dòng chờ thay vì
        // bấm rồi ăn 403.
      });
    return () => {
      daHuy = true;
    };
  }, [siteKey]);

  const datLai = useCallback(() => {
    datToken('');
    if (idWidget.current !== null) window.turnstile?.reset(idWidget.current);
  }, []);

  return { oWidget, token, dangCho: Boolean(siteKey) && !token, datLai };
}
