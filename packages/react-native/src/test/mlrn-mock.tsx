import { type ReactNode, type Ref, useImperativeHandle } from 'react';
import { vi } from 'vitest';

/** Ref giả của Map — test đặt kết quả cho queryRenderedFeatures/getBounds. */
export const mapRefMock = {
  queryRenderedFeatures: vi.fn(async () => [] as unknown[]),
  getBounds: vi.fn(async () => [106.6, 10.7, 106.8, 10.9] as [number, number, number, number]),
  showAttribution: vi.fn(async () => undefined),
  setSourceVisibility: vi.fn(async () => undefined),
};
export const cameraRefMock = { flyTo: vi.fn(), fitBounds: vi.fn(), easeTo: vi.fn() };

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
  for (const fn of Object.values(mapRefMock)) fn.mockClear();
  for (const fn of Object.values(cameraRefMock)) fn.mockClear();
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

export function GeoJSONSource(props: SourceProps) {
  lastSourceProps = props;
  return (
    <div data-testid={`mlrn-source-${props.id ?? 'x'}`} data-geojson={JSON.stringify(props.data)}>
      {props.children}
    </div>
  );
}

export function Layer(props: Record<string, unknown> & { id?: string }) {
  return <div data-testid={`mlrn-layer-${String(props.id)}`} data-layer={JSON.stringify(props)} />;
}

export function Images(props: { images: Record<string, unknown> }) {
  return <div data-testid="mlrn-images" data-keys={Object.keys(props.images).join(',')} />;
}
