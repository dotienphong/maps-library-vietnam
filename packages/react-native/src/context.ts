import type { CameraRef, MapRef } from '@maplibre/maplibre-react-native';
import type { DirectionsResponse, MapsLibVNClient } from '@mapslibvn/core';
import { type RefObject, createContext } from 'react';
import type { MapNavigationBinding } from './navigation/map-binding';

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
  /** Vẽ tuyến không cần phiên (xem trước, app khách). Phiên gắn vào sẽ ghi đè. */
  routes: {
    show(response: DirectionsResponse, opts?: { active?: number }): void;
    setActive(index: number): void;
    clear(): void;
  };
  /** Dẫn đường của map này: phiên qua prop `navigation`, không thì phiên mặc định tạo lười. */
  navigation: MapNavigationBinding;
}

export const MapContext = createContext<MapHandle | null>(null);
