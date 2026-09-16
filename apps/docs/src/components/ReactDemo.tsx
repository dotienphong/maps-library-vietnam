import { type AutocompleteItem, createClient } from '@mapslibvn/core';
import { MapsLibVNMap, Marker, useMap, usePlaces } from '@mapslibvn/react';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useMemo, useState } from 'react';
import { PRODUCTION_API_BASE, resolveApiBase } from '../lib/api-base';

/**
 * Khoá demo công khai của trang tài liệu. Nhúng lúc build từ `apps/docs/.env` (Astro chỉ đưa biến
 * tiền tố PUBLIC_ vào bundle trình duyệt), KHÔNG ghi thẳng vào mã: xoay khoá thì chỉ đổi .env rồi
 * build lại, và khoá không nằm vĩnh viễn trong lịch sử git.
 *
 * Khoá này là loại `web`, chỉ `places:read`, và máy chủ đối chiếu `Origin` với danh sách của khoá
 * — nằm công khai trong HTML là đúng thiết kế, không phải sơ suất.
 */
const API_KEY = import.meta.env.PUBLIC_MAPSLIBVN_DEMO_KEY ?? '';
const DEFAULT_CENTER: [number, number] = [106.7, 10.776];

function SelectedPlace({ item }: { item: AutocompleteItem }) {
  const map = useMap();
  useEffect(() => map.flyTo([item.lng, item.lat], 16), [map, item.lng, item.lat]);
  return <Marker lng={item.lng} lat={item.lat} />;
}

export default function ReactDemo() {
  const apiBase =
    typeof location === 'undefined'
      ? PRODUCTION_API_BASE
      : resolveApiBase(location.search, location.hostname);
  const client = useMemo(() => createClient({ apiKey: API_KEY, baseUrl: apiBase }), [apiBase]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<AutocompleteItem | null>(null);
  const { items, loading, error } = usePlaces(query, {
    client,
    near: [DEFAULT_CENTER[1], DEFAULT_CENTER[0]],
  });
  let status = 'Nhập ít nhất 2 ký tự.';
  if (loading) status = 'Đang tìm…';
  else if (error) status = 'Không thể tải kết quả. Hãy thử lại.';
  else if (selected) status = `Đã chọn ${selected.name}`;
  else if (query.trim().length >= 2)
    status = items.length > 0 ? `Có ${items.length} kết quả.` : 'Không tìm thấy kết quả.';

  if (!API_KEY) {
    // Thiếu khoá thì mọi request trả 401 và người xem chỉ thấy "Không thể tải kết quả" — nói
    // thẳng nguyên nhân còn hơn để người dựng trang đi dò.
    return (
      <main className="react-demo">
        <p className="react-demo__status">
          Bản demo cần khoá API. Đặt <code>PUBLIC_MAPSLIBVN_DEMO_KEY</code> trong{' '}
          <code>apps/docs/.env</code> rồi build lại trang.
        </p>
      </main>
    );
  }

  return (
    <main className="react-demo">
      <section className="react-demo__search" aria-label="Tìm địa điểm">
        <label htmlFor="react-demo-query">Địa điểm</label>
        <input
          id="react-demo-query"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setSelected(null);
          }}
          placeholder="Ví dụ: Highlands"
          autoComplete="off"
        />
        <p className="react-demo__status" aria-live="polite">
          {status}
        </p>
        <ul className="react-demo__results">
          {items.map((item) => (
            <li key={`${item.type}-${item.id ?? item.name}-${item.lat}-${item.lng}`}>
              <button type="button" onClick={() => setSelected(item)}>
                <span>{item.name}</span>
                {item.secondary ? <small>{item.secondary}</small> : null}
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="react-demo__map" aria-label="Bản đồ kết quả">
        <MapsLibVNMap apiKey={API_KEY} apiBase={apiBase} center={DEFAULT_CENTER} zoom={13}>
          {selected ? <SelectedPlace item={selected} /> : null}
        </MapsLibVNMap>
      </section>
    </main>
  );
}
