/**
 * Chọn một historical POI cho mỗi cụm theo bản ghi primary của POI *trước đó*.
 * Bản ghi đó có thể là secondary của cụm mới sau merge, nên không dùng role mới
 * làm tiêu chí sở hữu. Tie cuối bằng poi_id để DISTINCT ON luôn xác định.
 * @param {import('postgres').Sql} sql
 */
export async function assignHistoricalPoiIds(sql) {
  await sql.unsafe(`UPDATE poi_work_cluster_meta m SET poi_id = x.poi_id FROM (
      SELECT DISTINCT ON (c.cluster_no) c.cluster_no, l.poi_id
      FROM poi_work_cluster c
      JOIN poi_work_record r ON r.rid = c.rid
      JOIN poi_source_link l ON (l.source, l.source_id) = (r.source, r.source_id)
      JOIN poi p ON p.id = l.poi_id
      ORDER BY c.cluster_no,
        EXISTS (
          SELECT 1 FROM poi_work_cluster hc
          JOIN poi_work_record hr ON hr.rid = hc.rid
          WHERE hc.cluster_no = c.cluster_no
            AND hr.source = p.primary_source AND hr.source_id = p.primary_source_id
        ) DESC,
        l.poi_id
    ) x WHERE x.cluster_no = m.cluster_no`);
}

/**
 * Khi historical POI bị tách sang nhiều cụm, cụm còn chứa previous primary
 * giữ ID; các cụm còn lại được caller chuyển sang stable ID.
 * @param {import('postgres').Sql} sql
 */
export async function resolveHistoricalPoiIdConflicts(sql) {
  await sql.unsafe(`WITH conflicts AS (
      SELECT m.cluster_no, row_number() OVER (
        PARTITION BY m.poi_id
        ORDER BY EXISTS (
          SELECT 1
          FROM poi p
          JOIN poi_work_cluster c ON c.cluster_no = m.cluster_no
          JOIN poi_work_record r ON r.rid = c.rid
          WHERE p.id = m.poi_id
            AND r.source = p.primary_source AND r.source_id = p.primary_source_id
        ) DESC, m.cluster_no
      ) AS keep_rank
      FROM poi_work_cluster_meta m WHERE m.poi_id IS NOT NULL
    )
    UPDATE poi_work_cluster_meta m SET poi_id = NULL FROM conflicts c
    WHERE c.cluster_no = m.cluster_no AND c.keep_rank > 1`);
}

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
