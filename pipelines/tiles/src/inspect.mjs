#!/usr/bin/env node
import { openPmtiles } from './lib/node-source.mjs';

const path = process.argv[2];
if (!path) throw new Error('Dùng: node inspect.mjs <file.pmtiles>');

const { pmtiles, close } = await openPmtiles(path);
try {
  const header = await pmtiles.getHeader();
  const metadata = /** @type {{ vector_layers?: { id: string }[] }} */ (
    await pmtiles.getMetadata()
  );
  console.log(
    JSON.stringify(
      {
        zoom: [header.minZoom, header.maxZoom],
        bounds: [header.minLon, header.minLat, header.maxLon, header.maxLat],
        tiles: header.numTileEntries,
        layers: (metadata.vector_layers ?? []).map((layer) => layer.id),
      },
      null,
      2,
    ),
  );
} finally {
  await close();
}
