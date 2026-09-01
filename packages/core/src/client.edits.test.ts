import { describe, expect, it, vi } from 'vitest';
import { createClient } from './client';
import { MapsLibVNError } from './errors';

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

describe('client.suggestEdit', () => {
  it('POST /v1/edits với header X-Api-Key + body JSON, trả {edit_id, status, poi_id}', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ edit_id: 7, status: 'auto_approved', poi_id: '01A' }));
    const client = createClient({
      apiKey: 'mlv_live_x',
      baseUrl: 'https://api.test',
      fetch: fetchMock,
    });
    const result = await client.suggestEdit({
      poi_id: '01A',
      kind: 'update',
      changes: { hours: 'Mo-Su 08:00-21:00' },
      end_user_token: 'user-1',
    });
    expect(result).toEqual({ edit_id: 7, status: 'auto_approved', poi_id: '01A' });

    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(String(url)).toBe('https://api.test/v1/edits');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['X-Api-Key']).toBe('mlv_live_x');
    expect((init.headers as Record<string, string>)['content-type']).toBe('application/json');
    expect(JSON.parse(String(init.body))).toMatchObject({
      kind: 'update',
      end_user_token: 'user-1',
    });
  });

  it('create không cần poi_id; gửi đúng changes', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ edit_id: 8, status: 'pending', poi_id: '01NEW' }));
    const client = createClient({
      apiKey: 'k',
      baseUrl: 'https://api.test',
      fetch: fetchMock,
    });
    const result = await client.suggestEdit({
      kind: 'create',
      changes: { name: 'Bánh Mì Cô Ba', lat: 10.7735, lng: 106.699, category: 'restaurant' },
      end_user_token: 'user-2',
    });
    expect(result.status).toBe('pending');
    expect(result.poi_id).toBe('01NEW');
    const [, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(JSON.parse(String(init.body)).changes).toMatchObject({ name: 'Bánh Mì Cô Ba' });
  });

  it('lỗi API → MapsLibVNError với code từ body', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(
          { error: { code: 'quota_exceeded', message: 'Vượt giới hạn', request_id: 'r1' } },
          429,
        ),
      );
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fetchMock });
    await expect(
      client.suggestEdit({ poi_id: '01A', kind: 'close', end_user_token: 'u' }),
    ).rejects.toMatchObject({ status: 429, code: 'quota_exceeded', requestId: 'r1' });
    await expect(
      client.suggestEdit({ poi_id: '01A', kind: 'close', end_user_token: 'u' }),
    ).rejects.toBeInstanceOf(MapsLibVNError);
  });

  it('body lỗi không phải JSON → vẫn ném MapsLibVNError với http_error', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('<html>502</html>', { status: 502 }));
    const client = createClient({ apiKey: 'k', baseUrl: 'https://api.test', fetch: fetchMock });
    await expect(
      client.suggestEdit({ poi_id: '01A', kind: 'report', note: 'sai', end_user_token: 'u' }),
    ).rejects.toMatchObject({ status: 502, code: 'http_error' });
  });
});
