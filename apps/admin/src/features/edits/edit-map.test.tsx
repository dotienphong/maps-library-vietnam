// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { AdminEdit, EditDetail, PoiSnapshot } from './api';
import { EditMap, mapPlan } from './edit-map';

const EDIT: AdminEdit = {
  id: 1,
  poi_id: 'poi_1',
  poi_name: 'Quán',
  poi_status: 'active',
  poi_ward: null,
  poi_province: null,
  kind: 'update',
  changes: null,
  photo_url: null,
  note: null,
  status: 'pending',
  reviewer: null,
  created_at: new Date().toISOString(),
  tenant_id: 't1',
  distance_m: null,
};

const POI = { lat: 10.7721, lng: 106.7012 } as PoiSnapshot;

const detail = (
  over: Omit<Partial<EditDetail>, 'edit'> & { edit?: Partial<AdminEdit> },
): EditDetail => ({
  edit: { ...EDIT, ...over.edit },
  poi_hien_tai: over.poi_hien_tai ?? null,
  distance_m: over.distance_m ?? null,
  nearby: over.nearby ?? [],
});

describe('mapPlan', () => {
  it('update có đổi toạ độ → hai chốt kèm khoảng cách', () => {
    const plan = mapPlan(
      detail({
        edit: { changes: { lat: 10.7748, lng: 106.7031 } },
        poi_hien_tai: POI,
        distance_m: 340,
      }),
    );
    expect(plan).toMatchObject({ mode: 'so-sanh', distanceM: 340 });
  });

  it('update không đổi toạ độ → không vẽ bản đồ', () => {
    const plan = mapPlan(detail({ edit: { changes: { hours: {} } }, poi_hien_tai: POI }));
    expect(plan.mode).toBe('khong-ve');
  });

  it('create → một chốt kèm POI lân cận, dù POI staged đã tồn tại', () => {
    const plan = mapPlan(
      detail({
        edit: { kind: 'create', changes: { lat: 10.78, lng: 106.7 } },
        // POST /v1/edits dựng sẵn POI pending nên create vẫn có poi_hien_tai.
        poi_hien_tai: { lat: 10.78, lng: 106.7 } as PoiSnapshot,
        nearby: [
          { id: 'p2', name: 'Khác', category: null, lat: 10.78, lng: 106.7, distance_m: 40 },
        ],
      }),
    );
    expect(plan).toMatchObject({ mode: 'mot-chot' });
    expect(plan.mode === 'mot-chot' && plan.nearby).toHaveLength(1);
  });

  it('close → một chốt tại vị trí hiện tại', () => {
    const plan = mapPlan(detail({ edit: { kind: 'close', changes: null }, poi_hien_tai: POI }));
    expect(plan.mode).toBe('mot-chot');
  });

  it('không có toạ độ nào → không vẽ bản đồ', () => {
    expect(mapPlan(detail({ edit: { kind: 'close' } })).mode).toBe('khong-ve');
  });
});

describe('EditMap', () => {
  it('nhánh không vẽ thì KHÔNG tải maplibre-gl về', () => {
    const load = vi.fn();
    const { container } = render(
      <EditMap
        detail={detail({ edit: { changes: { hours: {} } }, poi_hien_tai: POI })}
        loadMap={load}
      />,
    );
    expect(load).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });

  it('nhánh so sánh hiện số mét ngay cả trước khi bản đồ tải xong', () => {
    render(
      <EditMap
        detail={detail({
          edit: { changes: { lat: 10.7748, lng: 106.7031 } },
          poi_hien_tai: POI,
          distance_m: 340,
        })}
        loadMap={vi.fn().mockResolvedValue(undefined)}
      />,
    );
    expect(screen.getByText(/Lệch 340 m/)).toBeVisible();
  });

  it('bản đồ hỏng thì hiện thông báo kèm lý do, không để khung trống câm lặng', async () => {
    render(
      <EditMap
        detail={detail({
          edit: { changes: { lat: 10.7748, lng: 106.7031 } },
          poi_hien_tai: POI,
          distance_m: 340,
        })}
        loadMap={async (_container, _plan, onError) => {
          onError('Bad response code: 404');
        }}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được bản đồ');
    expect(screen.getByRole('alert')).toHaveTextContent('Bad response code: 404');
  });

  it('loadMap ném lỗi cũng hiện thông báo chứ không nuốt', async () => {
    render(
      <EditMap
        detail={detail({
          edit: { changes: { lat: 10.7748, lng: 106.7031 } },
          poi_hien_tai: POI,
          distance_m: 340,
        })}
        loadMap={() => Promise.reject(new Error('Không tải được maplibre'))}
      />,
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Không tải được maplibre');
  });
});
