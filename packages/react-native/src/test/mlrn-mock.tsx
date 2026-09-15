import { type ReactNode, type Ref, useImperativeHandle } from 'react';
import { vi } from 'vitest';

/** Ref giả của Map — test đặt kết quả cho queryRenderedFeatures/getBounds. */
export const mapRefMock = {
  queryRenderedFeatures: vi.fn(async () => [] as unknown[]),
  getBounds: vi.fn(async () => [106.6, 10.7, 106.8, 10.9] as [number, number, number, number]),
  showAttribution: vi.fn(async () => undefined),
  setSourceVisibility: vi.fn(async () => undefined),
};
// Có implementation `() => undefined` chứ không để `vi.fn()` trần: vitest 4 làm kiểu suy ra của
// `vi.fn()` không đặt tên được nếu không tham chiếu `Procedure` của @vitest/spy, và TypeScript 6
// chặn việc đó bằng TS2883.
export const cameraRefMock = {
  flyTo: vi.fn(() => undefined),
  fitBounds: vi.fn(() => undefined),
  easeTo: vi.fn(() => undefined),
};

/** Pack offline giả — test đọc để kiểm `prefetch` đã tạo đúng vùng/zoom chưa. */
export type FakeOfflinePack = {
  id: string;
  metadata: Record<string, unknown>;
  bounds: unknown;
  minZoom: number | undefined;
  maxZoom: number | undefined;
  mapStyle: string | undefined;
};
export const offlinePacks: FakeOfflinePack[] = [];
export const OfflineManager = {
  getPacks: vi.fn(async () => offlinePacks as FakeOfflinePack[]),
  createPack: vi.fn(async (options: Record<string, unknown>) => {
    const pack: FakeOfflinePack = {
      id: `pack-${offlinePacks.length + 1}`,
      metadata: (options.metadata as Record<string, unknown>) ?? {},
      bounds: options.bounds,
      minZoom: options.minZoom as number | undefined,
      maxZoom: options.maxZoom as number | undefined,
      mapStyle: options.mapStyle as string | undefined,
    };
    offlinePacks.push(pack);
    return pack;
  }),
};

type MapProps = Record<string, unknown> & {
  children?: ReactNode;
  ref?: Ref<unknown>;
  mapStyle?: unknown;
};
let lastMapProps: MapProps | null = null;
export const getLastMapProps = () => lastMapProps;
export const resetMocks = () => {
  lastMapProps = null;
  lastSourceProps = null;
  for (const id of Object.keys(sourceProps)) delete sourceProps[id];
  for (const id of Object.keys(layerProps)) delete layerProps[id];
  offlinePacks.length = 0;
  for (const fn of Object.values(mapRefMock)) fn.mockClear();
  for (const fn of Object.values(cameraRefMock)) fn.mockClear();
  for (const fn of Object.values(OfflineManager)) fn.mockClear();
};

// biome-ignore lint/suspicious/noShadowRestrictedNames: tên phải khớp export của wrapper để vi.mock thay được
export function Map(props: MapProps) {
  lastMapProps = props;
  useImperativeHandle(props.ref as Ref<unknown>, () => mapRefMock);
  const style = props.mapStyle;
  return (
    <div
      data-testid="mlrn-map"
      data-style={typeof style === 'string' ? style : JSON.stringify(style)}
    >
      {props.children}
    </div>
  );
}

export function Camera(props: { ref?: Ref<unknown>; initialViewState?: unknown }) {
  useImperativeHandle(props.ref as Ref<unknown>, () => cameraRefMock);
  return <div data-testid="mlrn-camera" data-view={JSON.stringify(props.initialViewState)} />;
}

export function Marker(props: {
  lngLat: [number, number];
  anchor?: string;
  onPress?: () => void;
  children: ReactNode;
  testID?: string;
}) {
  return (
    // Mock thay cho Marker native trong test, không bao giờ render cho người dùng thật nên quy tắc
    // a11y không áp dụng.
    // biome-ignore lint/a11y/noStaticElementInteractions: xem ngay trên
    <div
      data-testid={props.testID ?? 'mlrn-marker'}
      data-lnglat={props.lngLat.join(',')}
      data-anchor={props.anchor ?? 'center'}
      onClick={props.onPress}
      onKeyDown={props.onPress}
    >
      {props.children}
    </div>
  );
}

type SourceProps = {
  id?: string;
  data: unknown;
  onPress?: (e: unknown) => void;
  children?: ReactNode;
};
let lastSourceProps: SourceProps | null = null;
export const getLastSourceProps = () => lastSourceProps;
/** Props theo id source — cần từ khi tuyến có hai source (chính + thay thế). */
const sourceProps: Record<string, SourceProps> = {};
export const getSourceProps = (id: string): SourceProps | undefined => sourceProps[id];

export function GeoJSONSource(props: SourceProps) {
  lastSourceProps = props;
  if (props.id) sourceProps[props.id] = props;
  return (
    <div data-testid={`mlrn-source-${props.id ?? 'x'}`} data-geojson={JSON.stringify(props.data)}>
      {props.children}
    </div>
  );
}

/**
 * Props lần render gần nhất của mỗi layer, theo id — test đọc để kiểm tham chiếu `paint` có đổi
 * không. Là object thường chứ không phải `Map` vì `Map` trong file này là component giả của MLRN.
 */
export const layerProps: Record<string, Record<string, unknown>> = {};

export function Layer(props: Record<string, unknown> & { id?: string }) {
  layerProps[String(props.id)] = props;
  return <div data-testid={`mlrn-layer-${String(props.id)}`} data-layer={JSON.stringify(props)} />;
}

export function Images(props: { images: Record<string, unknown> }) {
  return <div data-testid="mlrn-images" data-keys={Object.keys(props.images).join(',')} />;
}
