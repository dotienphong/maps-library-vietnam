REVOKE INSERT (
  key_hash, key_prefix, tenant_id, label, kind,
  allowed_origins, allowed_bundle_ids, scopes, quota_directions_per_day
) ON api_key FROM api;
