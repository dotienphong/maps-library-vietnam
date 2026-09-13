const MIGRATION_FILE = /^\d{4}_.+\.sql$/;
const DOWN_FILE = /\.down\.sql$/;

/**
 * Migration mới nhất trong db/migrations theo tiền tố số.
 * @param {string[]} files tên file trong thư mục
 * @returns {string | null}
 */
export function latestMigrationName(files) {
  const applied = files.filter((file) => MIGRATION_FILE.test(file) && !DOWN_FILE.test(file)).sort();
  return applied.at(-1) ?? null;
}

/** `/healthz/db` trả `max(name)` của schema_migrations; tên lưu có đuôi `.sql` nhưng đừng phụ
 * thuộc vào đó. @param {string} name */
const stem = (name) => name.replace(/\.sql$/, '');

/**
 * Cổng chặn deploy: Worker mới KHÔNG được lên trước migration mà nó cần.
 *
 * Sự cố 06–07/09/2026: Worker mang code đọc cột/bảng của migration chưa áp được deploy trước, và
 * `/v1/autocomplete` trả 503 suốt nhiều giờ trong khi `Deploy API` vẫn xanh và `/healthz` vẫn 200.
 * `apitest` chỉ chứng minh code đúng với schema trong CI, không nói gì về schema production.
 *
 * Chiều ngược lại (DB mới hơn repo) là hợp lệ và phải cho qua: quy trình đúng là áp migration
 * TRƯỚC rồi mới deploy, nên ở khoảnh khắc deploy, DB thường đã đi trước một bước.
 *
 * @param {string | null} localLatest migration mới nhất trong repo
 * @param {string | null} remoteApplied `schema_migration` mà /healthz/db báo
 * @returns {{ ok: boolean, message: string }}
 */
export function migrationGate(localLatest, remoteApplied) {
  if (localLatest === null) {
    return { ok: true, message: 'Repo không có migration nào — bỏ qua cổng.' };
  }
  if (remoteApplied === null) {
    return {
      ok: false,
      message:
        '/healthz/db không trả `schema_migration` (bảng schema_migrations thiếu, hoặc role api ' +
        'không có quyền SELECT trên nó). Không đoán được trạng thái schema nên chặn deploy.',
    };
  }
  const local = stem(localLatest);
  const remote = stem(remoteApplied);
  if (remote === local) {
    return { ok: true, message: `DB production đã ở ${localLatest}.` };
  }
  if (remote > local) {
    return {
      ok: true,
      message: `DB production ở ${remoteApplied}, mới hơn ${localLatest} của repo — hợp lệ.`,
    };
  }
  return {
    ok: false,
    message: `DB production mới ở ${remoteApplied} nhưng repo đã có ${localLatest}. Deploy bây giờ sẽ đưa Worker đọc schema chưa tồn tại. Chạy \`pnpm server:migrate\` trên máy chủ, kiểm lại \`/healthz/db\`, rồi deploy lại.`,
  };
}
