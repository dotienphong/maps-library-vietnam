import { writeAudit } from '../audit';
import type { getSql } from '../db';
import type { MauThu } from '../email/mau';
import { conCho, conChoHangLoat, daGuiHomNayVoiSql } from '../email/ngan-sach';
import { chonEmailPort, type EmailPort } from '../email/port';
import type { Env } from '../env';
import { moTaLoi } from '../errors';

type Sql = ReturnType<typeof getSql>;

export interface ThuGiaoDich {
  to: string[];
  mau: MauThu;
  /** Ghi vào `target` của dòng `email.sent`: bien-nhan | thieu-tien | thieu-tien-admin | nhac-han. */
  loai: string;
  /** Thư nhắc hạn: dừng sớm hơn để chừa suất cho mã đăng nhập (spec 9.4). */
  hangLoat?: boolean;
}

export interface GuiThuDeps {
  port?: EmailPort;
}

/**
 * Gửi một thư giao dịch trong ngân sách 100 thư/ngày của Resend. KHÔNG bao giờ ném: thư là việc
 * phụ của một giao dịch tiền đã xong, và một lỗi ở đây không được biến `fulfilled` thành 503.
 * Trả `true` chỉ khi MỌI người nhận đều đã gửi.
 *
 * Kiểm ngân sách cho cả lô: gửi nửa lô rồi hết suất là kiểu hỏng khó lần nhất — khách nhận biên
 * nhận mà admin không nhận cảnh báo, hoặc ngược lại.
 */
export async function guiThuGiaoDich(
  env: Env,
  sql: Sql,
  thu: ThuGiaoDich,
  deps: GuiThuDeps = {},
): Promise<boolean> {
  try {
    const daGui = await daGuiHomNayVoiSql(sql);
    const sauKhiGui = daGui + thu.to.length - 1;
    const con = thu.hangLoat ? conChoHangLoat(sauKhiGui) : conCho(sauKhiGui);
    if (!con) {
      console.warn(`[email] bỏ qua ${thu.loai}: ngân sách ngày đã dùng ${daGui}/100`);
      return false;
    }
    const port = deps.port ?? chonEmailPort(env);
    for (const to of thu.to) {
      await port.send({ to, subject: thu.mau.subject, html: thu.mau.html, text: thu.mau.text });
      await writeAudit(sql, { actor: 'system:email', action: 'email.sent', target: thu.loai });
    }
    return true;
  } catch (error) {
    // In CẢ message: Workers Observability chỉ giữ stack khi nhận một Error, và chính điều đó đã
    // giấu mất `email_send_failed_401` trong sự cố Resend ngày 19/09/2026.
    console.error(`[email] gửi ${thu.loai} lỗi: ${moTaLoi(error)}`, error);
    return false;
  }
}
