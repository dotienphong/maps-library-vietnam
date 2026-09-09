-- Tenant free thử nghiệm cho nghiệm thu 429 (spec 13/M3). Quota nhỏ để test nhanh.
INSERT INTO tenant (id, name, plan)
VALUES ('00000000-0000-4000-8000-0000000000bb', 'Free thử nghiệm', 'free')
ON CONFLICT (id) DO NOTHING;

INSERT INTO api_key (key_hash, key_prefix, tenant_id, label, kind, scopes, quota_places_per_day)
VALUES (encode(sha256(convert_to('mlv_live_freetest0000000000000000', 'UTF8')), 'hex'), 'mlv_live_freetest', '00000000-0000-4000-8000-0000000000bb',
        'free test 429', 'server', '{places:read}', 25)
ON CONFLICT (key_hash) DO NOTHING;
