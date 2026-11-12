// Misma regla de existencias del programa de remisiones: escaneos menos ventas,
// traslados, desechos y ajustes, agrupada aquí sin exponer lotes ni variedades.
const query = `
WITH scanned AS (
  SELECT ts::date AS source_date, TRIM(variedad_nombre) AS variety,
         UPPER(TRIM(grado_cm)) AS grade_cm, tallos AS stems_per_bunch,
         COUNT(*)::int AS source_bunches, SUM(tallos)::int AS source_stems
  FROM public.scans
  WHERE UPPER(TRIM(grado_cm)) = ANY($1::text[])
    AND ts::date >= $2::date AND variedad_nombre IS NOT NULL
    AND TRIM(variedad_nombre) <> '' AND tallos IS NOT NULL AND tallos > 0
  GROUP BY ts::date,TRIM(variedad_nombre),UPPER(TRIM(grado_cm)),tallos
), source AS (
  SELECT source_date,variety,grade_cm,stems_per_bunch,
         SUM(source_bunches)::int AS source_bunches,SUM(source_stems)::int AS source_stems
  FROM (
    SELECT * FROM scanned
    UNION ALL
    SELECT source_date,variety,to_grade AS grade_cm,stems_per_bunch,
           SUM(bunches)::int,SUM(bunches*stems_per_bunch)::int
    FROM inventory_grade_transfers GROUP BY source_date,variety,to_grade,stems_per_bunch
  ) entries GROUP BY source_date,variety,grade_cm,stems_per_bunch
), used AS (
  SELECT source_date,variety,COALESCE(source_grade_cm,grade_cm) AS grade_cm,
         stems_per_bunch, COALESCE(SUM(bunches),0)::int AS used_bunches,
         COALESCE(SUM(stems),0)::int AS used_stems
  FROM remission_items ri JOIN remissions r ON r.id=ri.remission_id
  WHERE source_date IS NOT NULL AND r.status <> 'ANULADA'
  GROUP BY source_date,variety,COALESCE(source_grade_cm,grade_cm),stems_per_bunch
), adjusted AS (
  SELECT source_date,variety,grade_cm,stems_per_bunch,SUM(delta_bunches)::int AS delta_bunches
  FROM inventory_adjustments WHERE canceled_at IS NULL
  GROUP BY source_date,variety,grade_cm,stems_per_bunch
), transferred AS (
  SELECT ti.source_date,ti.variety,ti.stems_per_bunch,SUM(ti.bunches)::int AS transferred_bunches
  FROM export_transfer_items ti JOIN export_transfers t ON t.id=ti.transfer_id
  WHERE t.canceled_at IS NULL GROUP BY ti.source_date,ti.variety,ti.stems_per_bunch
), regraded AS (
  SELECT source_date,variety,from_grade AS grade_cm,stems_per_bunch,SUM(bunches)::int AS bunches
  FROM inventory_grade_transfers GROUP BY source_date,variety,from_grade,stems_per_bunch
), discarded AS (
  SELECT source_date,variety,grade_cm,stems_per_bunch,SUM(bunches)::int AS waste_bunches
  FROM inventory_waste WHERE canceled_at IS NULL GROUP BY source_date,variety,grade_cm,stems_per_bunch
)
SELECT source.variety,source.grade_cm,source.stems_per_bunch,
       GREATEST(source.source_bunches-COALESCE(used.used_bunches,0)
         -CASE WHEN source.grade_cm='BAJAS' THEN COALESCE(transferred.transferred_bunches,0) ELSE 0 END
         -COALESCE(regraded.bunches,0)-COALESCE(discarded.waste_bunches,0)
         +COALESCE(adjusted.delta_bunches,0),0)::int AS bunches,
       GREATEST(source.source_stems-COALESCE(used.used_stems,0)
         -CASE WHEN source.grade_cm='BAJAS' THEN COALESCE(transferred.transferred_bunches,0)*source.stems_per_bunch ELSE 0 END
         -COALESCE(regraded.bunches,0)*source.stems_per_bunch-COALESCE(discarded.waste_bunches,0)*source.stems_per_bunch
         +COALESCE(adjusted.delta_bunches,0)*source.stems_per_bunch,0)::int AS stems
FROM source
LEFT JOIN used USING (source_date,variety,grade_cm,stems_per_bunch)
LEFT JOIN adjusted USING (source_date,variety,grade_cm,stems_per_bunch)
LEFT JOIN regraded USING (source_date,variety,grade_cm,stems_per_bunch)
LEFT JOIN transferred ON transferred.source_date=source.source_date AND transferred.variety=source.variety
  AND transferred.stems_per_bunch=source.stems_per_bunch AND source.grade_cm='BAJAS'
LEFT JOIN discarded ON discarded.source_date=source.source_date AND discarded.variety=source.variety
  AND discarded.grade_cm=source.grade_cm AND discarded.stems_per_bunch=source.stems_per_bunch
WHERE source.source_bunches-COALESCE(used.used_bunches,0)
  -CASE WHEN source.grade_cm='BAJAS' THEN COALESCE(transferred.transferred_bunches,0) ELSE 0 END
  -COALESCE(regraded.bunches,0)-COALESCE(discarded.waste_bunches,0)+COALESCE(adjusted.delta_bunches,0) > 0`;

async function listInventory(pool) {
  const { rows } = await pool.query(query, [['BAJAS', 'BAJAS GRANEL', 'NACIONAL', 'NACIONAL GRANEL'], '2026-09-21']);
  return rows.map(row => ({ variety: row.variety, gradeCm: row.grade_cm, stemsPerBunch: Number(row.stems_per_bunch), bunches: Number(row.bunches), stems: Number(row.stems) }));
}
module.exports = { listInventory };
