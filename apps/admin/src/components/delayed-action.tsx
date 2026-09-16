import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { setReloadGuard } from '@/lib/fetcher';
import { Button } from './ui/button';

const DELAY_MS = 5000;

interface ScheduleInput {
  label: string;
  run: () => Promise<void>;
  onCancel?: () => void;
}

interface Pending extends ScheduleInput {
  id: number;
  remaining: number;
}

interface DelayedActionValue {
  schedule: (input: ScheduleInput) => void;
}

const Context = createContext<DelayedActionValue | null>(null);

export function useDelayedAction(): DelayedActionValue {
  const value = useContext(Context);
  if (!value) throw new Error('useDelayedAction phải nằm trong DelayedActionProvider');
  return value;
}

/**
 * Hoãn gửi 5 giây thay vì hoàn tác sau khi đã gửi. Với những thao tác ghi thẳng vào dữ liệu thật
 * — duyệt đóng góp gọi apply_poi_edit rồi xoá cache — đảo ngược sạch sẽ là không làm được, nên
 * cách an toàn là chưa làm gì cho tới khi người dùng hết cơ hội đổi ý.
 */
export function DelayedActionProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const nextId = useRef(0);
  const pendingRef = useRef<Pending | null>(null);
  pendingRef.current = pending;

  // Chặn fetcher tự tải lại trang khi phiên hết hạn giữa lúc đang đếm ngược: tải lại sẽ nuốt mất
  // một thao tác mà người dùng tưởng đã làm xong.
  useEffect(() => {
    setReloadGuard(() => pendingRef.current !== null);
    return () => setReloadGuard(() => false);
  }, []);

  const pendingId = pending?.id;
  useEffect(() => {
    if (pendingId === undefined) return;
    const timer = setInterval(() => {
      setPending((current) => {
        if (!current) return null;
        const remaining = current.remaining - 1000;
        if (remaining > 0) return { ...current, remaining };
        void current.run();
        return null;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, [pendingId]);

  const schedule = useCallback((input: ScheduleInput) => {
    setPending((current) => {
      // Xếp việc mới khi việc cũ chưa gửi: gửi luôn việc cũ, không bỏ rơi nó.
      if (current) void current.run();
      nextId.current += 1;
      return { ...input, id: nextId.current, remaining: DELAY_MS };
    });
  }, []);

  const cancel = useCallback(() => {
    setPending((current) => {
      current?.onCancel?.();
      return null;
    });
  }, []);

  const value = useMemo(() => ({ schedule }), [schedule]);

  return (
    <Context.Provider value={value}>
      {children}
      {pending && (
        <div
          role="status"
          className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-md items-center gap-3 rounded-[var(--radius-btn)] bg-[var(--text)] px-4 py-3 text-sm text-[var(--bg)] shadow-lg"
          style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
        >
          <span className="flex-1">
            {pending.label} · gửi sau {Math.ceil(pending.remaining / 1000)} giây
          </span>
          <Button variant="ghost" className="text-[var(--bg)] underline" onClick={cancel}>
            Huỷ
          </Button>
        </div>
      )}
    </Context.Provider>
  );
}
