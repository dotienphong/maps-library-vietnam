import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardMuted, CardTitle } from '@/components/ui/card';
import type { Tenant } from './api';

/** Ngày tuyệt đối, không phải "3 ngày trước": tenant sống nhiều năm, ngày tạo là mốc tra cứu. */
export function tenantDate(iso: string): string {
  return new Date(iso).toLocaleDateString('vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
}

export const MODE_VI: Record<Tenant['quota_mode'], string> = {
  legacy: 'Chưa tính tiền',
  commercial: 'Thương mại',
};

export function TenantCard({ tenant, onOpen }: { tenant: Tenant; onOpen: (id: string) => void }) {
  return (
    <Card>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <CardTitle>{tenant.name}</CardTitle>
          <CardMuted>Tạo ngày {tenantDate(tenant.created_at)}</CardMuted>
        </div>
        <Badge tone={tenant.quota_mode === 'commercial' ? 'brand' : 'neutral'}>
          {MODE_VI[tenant.quota_mode]}
        </Badge>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Badge>{tenant.plan}</Badge>
        <Badge tone={tenant.active_keys > 0 ? 'success' : 'warning'}>
          {tenant.active_keys} khoá
        </Badge>
        <Button variant="secondary" className="ml-auto" onClick={() => onOpen(tenant.id)}>
          Xem khoá
        </Button>
      </div>
    </Card>
  );
}
