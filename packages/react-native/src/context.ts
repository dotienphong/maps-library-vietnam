import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { MapsLibVNClient } from '@mapslibvn/core';
import { type RefObject, createContext } from 'react';

/** Tay cầm map — tương ứng `MapsLibVNMap` của web: `native` thay `gl`. */
export interface MapHandle {
  /** Ref `Map` của @maplibre/maplibre-react-native — không giấu gì. */
  native: RefObject<MapRef | null>;
  camera: RefObject<CameraRef | null>;
  /** Client @mapslibvn/core với cùng khoá. */
  places: MapsLibVNClient;
  flyTo(center: [number, number], zoom?: number): void;
  fitBounds(bbox: [number, number, number, number], padding?: number): void;
  /** [west, south, east, north] */
  getBounds(): Promise<[number, number, number, number]>;
}

export const MapContext = createContext<MapHandle | null>(null);
