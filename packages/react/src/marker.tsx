import type { MarkerOptions } from '@mapslibvn/web';
import { useEffect } from 'react';
import { useMap } from './map';

export function Marker({ lng, lat, popupText, popupHtml, color }: MarkerOptions) {
  const map = useMap();

  useEffect(() => {
    const options: MarkerOptions = { lng, lat };
    if (popupText !== undefined) options.popupText = popupText;
    if (popupHtml !== undefined) options.popupHtml = popupHtml;
    if (color !== undefined) options.color = color;
    const marker = map.addMarker(options);
    return () => {
      marker.remove();
    };
  }, [map, lng, lat, popupText, popupHtml, color]);

  return null;
}
