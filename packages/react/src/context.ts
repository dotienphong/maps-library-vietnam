import type { MapsLibVNMap as WebMap } from '@mapslibvn/web';
import { createContext } from 'react';

export const MapContext = createContext<WebMap | null>(null);
