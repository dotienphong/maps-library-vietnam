// Cùng origin với Worker nên fetch tương đối — Access đã đứng trước /admin và /v1/admin.
export interface AdminEdit {
  id: number;
  poi_id: string | null;
  poi_name: string | null;
  poi_status: string | null;
  kind: 'create' | 'update' | 'close' | 'reopen' | 'report';
  changes: Record<string, unknown> | null;
  photo_url: string | null;
  note: string | null;
  status: string;
  reviewer: string | null;
  created_at: string;
  tenant_id: string;
}

export type EditStatus = 'pending' | 'approved' | 'rejected' | 'auto_approved';

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response;
  let detail = `HTTP ${response.status}`;
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    if (body.error?.message) detail = `${detail} — ${body.error.message}`;
  } catch {
    // Body lỗi có thể không phải JSON (vd trang chặn của Cloudflare Access).
  }
  throw new Error(detail);
}

export async function listEdits(status: EditStatus): Promise<AdminEdit[]> {
  const response = await ensureOk(await fetch(`/v1/admin/edits?status=${status}`));
  return ((await response.json()) as { items: AdminEdit[] }).items;
}

export async function reviewEdit(id: number, action: 'approve' | 'reject'): Promise<void> {
  await ensureOk(await fetch(`/v1/admin/edits/${id}/${action}`, { method: 'POST' }));
}
