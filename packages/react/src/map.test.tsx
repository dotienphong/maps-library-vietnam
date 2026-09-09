// @vitest-environment jsdom
import { createMap } from '@mapslibvn/web';
import { cleanup, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MapsLibVNMap } from './map';

vi.mock('maplibre-gl', () => ({ default: {} }));
vi.mock('@mapslibvn/web', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@mapslibvn/web')>()),
  createMap: vi.fn(),
}));

const createMapMock = vi.mocked(createMap);

beforeEach(() => {
  createMapMock.mockImplementation(
    () =>
      ({
        on: vi.fn(),
        remove: vi.fn(),
      }) as never,
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('MapsLibVNMap', () => {
  it('truyền profile mới vào web map và tạo lại khi prop đổi', async () => {
    const { rerender } = render(
      <MapsLibVNMap apiKey="k" apiBase="https://api.test" poiSources={['fsq']} />,
    );
    await waitFor(() => expect(createMapMock).toHaveBeenCalledTimes(1));
    expect(createMapMock.mock.calls[0]?.[0]).toMatchObject({ poiSources: ['fsq'] });

    rerender(<MapsLibVNMap apiKey="k" apiBase="https://api.test" poiSources={['osm', 'fsq']} />);
    await waitFor(() => expect(createMapMock).toHaveBeenCalledTimes(2));
    expect(createMapMock.mock.calls[1]?.[0]).toMatchObject({
      poiSources: ['osm', 'fsq'],
    });

    rerender(
      <MapsLibVNMap apiKey="k" apiBase="https://api.test" poiSources={['overture', 'fsq']} />,
    );
    await waitFor(() => expect(createMapMock).toHaveBeenCalledTimes(3));
    expect(createMapMock.mock.calls[2]?.[0]).toMatchObject({
      poiSources: ['overture', 'fsq'],
    });
  });
});
