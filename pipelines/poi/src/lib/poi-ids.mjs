/**
 * Xử lý chuỗi POI ID lịch sử bị tách cụm. Mỗi vòng giữ ID của chính stable ID
 * trước, rồi đẩy cụm thua về stable ID của nó. Chuỗi hữu hạn vì stable_id là
 * duy nhất; nếu giả định đó bị phá, fail trước publish thay vì tạo PK trùng.
 * @param {import('postgres').Sql} sql
 */
export async function resolvePoiIds(sql) {
  const stable = /** @type {any} */ (
    (
      await sql`SELECT count(*)::int AS stable_dups FROM (
        SELECT stable_id FROM poi_work_cluster_meta GROUP BY stable_id HAVING count(*) > 1
      ) d`
    )[0]
  );
  if (stable?.stable_dups) throw new Error(`stable_id không duy nhất: ${stable.stable_dups}`);

  const total = /** @type {any} */ (
    (await sql`SELECT count(*)::int AS clusters FROM poi_work_cluster_meta`)[0]
  );
  for (let round = 0; round <= Number(total?.clusters ?? 0); round++) {
    await sql.unsafe(`WITH conflicts AS (
      SELECT m.cluster_no, row_number() OVER (
        PARTITION BY m.poi_id
        ORDER BY (m.poi_id = m.stable_id) DESC, m.cluster_no
      ) AS keep_rank
      FROM poi_work_cluster_meta m
    )
    UPDATE poi_work_cluster_meta m SET poi_id = m.stable_id FROM conflicts c
    WHERE c.cluster_no = m.cluster_no AND c.keep_rank > 1`);
    const duplicates = /** @type {any} */ (
      (
        await sql`SELECT count(*)::int AS duplicate_ids FROM (
          SELECT poi_id FROM poi_work_cluster_meta GROUP BY poi_id HAVING count(*) > 1
        ) d`
      )[0]
    );
    if (!duplicates?.duplicate_ids) return;
  }
  throw new Error('Không thể tạo poi_id duy nhất sau khi xử lý chuỗi va chạm');
}

/**
 * Cộng contribution chỉ sau khi poi_id đã unique, nên mỗi edit lịch sử có nhiều
 * nhất một cụm nhận điểm khi POI tách.
 * @param {import('postgres').Sql} sql
 */
export async function applyApprovedEditPopularity(sql) {
  await sql.unsafe(`WITH approved_edits AS (
      SELECT e.poi_id, count(*)::real AS n
      FROM poi_edit e JOIN poi_work_cluster_meta m ON m.poi_id = e.poi_id
      WHERE e.status IN ('approved', 'auto_approved')
      GROUP BY e.poi_id
    )
    UPDATE poi_work_cluster_meta m
    SET popularity = m.popularity + LEAST(1::real, 0.2::real * e.n)
    FROM approved_edits e WHERE e.poi_id = m.poi_id`);
}
