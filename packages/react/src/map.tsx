import {
  type CreateMapOptions,
  type PoiFeature,
  type MapsLibVNMap as WebMap,
  createMap,
} from '@mapslibvn/web';
import maplibregl from 'maplibre-gl';
import { type CSSProperties, type ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { MapContext } from './context';

export interface MapsLibVNMapProps extends Omit<CreateMapOptions, 'container'> {
  className?: string;
  /** CSS của khung map — khác prop `style` (theme) từ CreateMapOptions. */
  containerStyle?: CSSProperties;
  onPoiClick?: (poi: PoiFeature) => void;
  onLoad?: (map: WebMap) => void;
  children?: ReactNode;
}

export function MapsLibVNMap({
  apiKey,
  apiBase,
  style: mapStyle,
  center,
  zoom,
  lang,
  poiLayer,
  compactAttribution,
  className,
  containerStyle,
  onPoiClick,
  onLoad,
  children,
}: MapsLibVNMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [map, setMap] = useState<WebMap | null>(null);
  const handlers = useRef({ onPoiClick, onLoad });
  handlers.current = { onPoiClick, onLoad };

  useEffect(() => {
    if (!containerRef.current) return;
    const options: CreateMapOptions = { container: containerRef.current, apiKey, apiBase };
    if (mapStyle !== undefined) options.style = mapStyle;
    if (center !== undefined) options.center = center;
    if (zoom !== undefined) options.zoom = zoom;
    if (lang !== undefined) options.lang = lang;
    if (poiLayer !== undefined) options.poiLayer = poiLayer;
    if (compactAttribution !== undefined) options.compactAttribution = compactAttribution;

    const nextMap = createMap(options, { maplibre: maplibregl as never });
    nextMap.on('poiClick', (poi) => handlers.current.onPoiClick?.(poi));
    nextMap.on('load', () => handlers.current.onLoad?.(nextMap));
    setMap(nextMap);
    return () => {
      nextMap.remove();
      setMap((current) => (current === nextMap ? null : current));
    };
  }, [
    apiKey,
    apiBase,
    mapStyle,
    center?.[0],
    center?.[1],
    zoom,
    lang,
    poiLayer,
    compactAttribution,
  ]);

  return (
    <div
      className={className}
      style={{
        width: '100%',
        height: '100%',
        ...containerStyle,
        position: containerStyle?.position ?? 'relative',
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      {map ? <MapContext.Provider value={map}>{children}</MapContext.Provider> : null}
    </div>
  );
}

/** Map hiện hành — chỉ dùng bên trong <MapsLibVNMap>. */
export function useMap(): WebMap {
  const map = useContext(MapContext);
  if (!map) throw new Error('useMap phải được gọi bên trong <MapsLibVNMap>');
  return map;
}
