import type { Env } from '../env';
import { debugPort } from './debug';
import { resendPort } from './resend';

export interface ThuGui {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export interface EmailPort {
  /** Tên bản đang dùng, để log và để test khẳng định — không dùng cho logic nghiệp vụ. */
  ten: 'resend' | 'debug' | 'thieu-cau-hinh';
  send(thu: ThuGui): Promise<{ id: string }>;
}

export type EmailEnv = Pick<Env, 'ENVIRONMENT' | 'RESEND_API_KEY' | 'EMAIL_FROM' | 'SUPPORT_EMAIL'>;

/**
 * Production mà thiếu khoá thì KHÔNG rơi về bản ghi log: thư không gửi mà hệ thống báo thành công
 * là kiểu hỏng tệ nhất — khách ngồi chờ mã không bao giờ tới, còn log thì xanh.
 */
export function chonEmailPort(env: EmailEnv, fetchImpl: typeof fetch = fetch): EmailPort {
  if (env.RESEND_API_KEY) return resendPort(env, fetchImpl);
  if (env.ENVIRONMENT === 'production') {
    return {
      ten: 'thieu-cau-hinh',
      send() {
        return Promise.reject(new Error('email_not_configured'));
      },
    };
  }
  return debugPort();
}
