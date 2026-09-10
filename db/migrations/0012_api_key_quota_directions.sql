-- Spec dẫn đường A (10/09/2026) mục 5.5: quota ngày riêng cho GET /v1/directions.
-- NULL = dùng mặc định plan (FREE_DIRECTIONS_PER_DAY = 2.000 trong Worker); tenant internal không đếm.
-- Worker đọc cột qua to_jsonb(k) ->> 'quota_directions_per_day' nên deploy trước/sau migration đều được.
ALTER TABLE api_key ADD COLUMN IF NOT EXISTS quota_directions_per_day int;
