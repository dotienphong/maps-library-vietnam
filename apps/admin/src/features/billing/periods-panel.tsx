import { RecordView } from '@/components/data-view';
import { EmptyState } from '@/components/states';
import { Badge } from '@/components/ui/badge';
import { Card, CardMuted, CardTitle } from '@/components/ui/card';
import type { PeriodHistory, PeriodSummary } from './api';
import { ngayVn, so } from './usage-panel';

const khoang = (period: PeriodSummary) => `${ngayVn(period.startsAt)} → ${ngayVn(period.endsAt)}`;
const doiNhom = (nhan: string, group: { limit: number; used: number }) =>
  `${nhan} ${so(group.used)} / ${so(group.limit)}`.trim();

export function PeriodsPanel({ history }: { history: PeriodHistory }) {
  return (
    <section className="space-y-3">
      <h2 className="text-base font-semibold">Các kỳ đã cấp</h2>

      {history.periods.length === 0 ? (
        <EmptyState
          title="Chưa có kỳ nào trong sổ"
          hint="Bật bản dùng thử hoặc cấp một kỳ trả phí bằng các nút ở trên."
        />
      ) : (
        <RecordView
          items={history.periods}
          rowKey={(period) => period.periodId}
          renderCard={(period) => (
            <Card>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <CardTitle>{khoang(period)}</CardTitle>
                  <CardMuted>
                    {doiNhom('Places', period.places)} · {doiNhom('Directions', period.directions)}
                  </CardMuted>
                </div>
                <Badge tone={period.tier === 'trial' ? 'neutral' : 'brand'}>{period.tier}</Badge>
              </div>
              {period.paymentReference && (
                <p className="mt-2 text-xs text-[var(--text-muted)]">
                  {period.paymentReference} · {period.lineItemId}
                </p>
              )}
            </Card>
          )}
          columns={[
            { key: 'ky', header: 'Kỳ', render: khoang },
            {
              key: 'bac',
              header: 'Bậc',
              render: (period) => (
                <Badge tone={period.tier === 'trial' ? 'neutral' : 'brand'}>{period.tier}</Badge>
              ),
            },
            { key: 'places', header: 'Places', render: (period) => doiNhom('', period.places) },
            {
              key: 'directions',
              header: 'Directions',
              render: (period) => doiNhom('', period.directions),
            },
            {
              key: 'thanhtoan',
              header: 'Thanh toán',
              render: (period) => period.paymentReference ?? '—',
            },
          ]}
        />
      )}

      {history.credits.length > 0 && (
        <>
          <h2 className="text-base font-semibold">Credit đã cộng</h2>
          <ul className="space-y-2">
            {history.credits.map((credit) => (
              <li
                key={credit.grantId}
                className="rounded-[var(--radius-btn)] border border-[var(--border)] p-3 text-sm"
              >
                <p>
                  <strong>
                    {credit.group} +{so(credit.units)}
                  </strong>{' '}
                  · còn {so(credit.units - credit.used - credit.reserved)} · hết hạn{' '}
                  {ngayVn(credit.expiresAt)}
                </p>
                <p className="text-xs text-[var(--text-muted)]">
                  {credit.paymentReference} · {credit.lineItemId}
                </p>
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
