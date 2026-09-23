const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const usePostgres = Boolean(process.env.DATABASE_URL);
const dataDirectory = path.join(process.cwd(), '.data');
const dataFile = path.join(dataDirectory, 'flor-data.json');
const allowedGrades = ['BAJAS', 'NACIONAL', 'NACIONAL GRANEL'];
const exportGrades = ['40', '50', '60'];
const priceGrades = [...allowedGrades, ...exportGrades];
const businessTimeZone = process.env.BUSINESS_TIME_ZONE || 'America/Cancun';

let pool;
let memory;

const initialData = () => ({
  nextInventoryId: 6,
  nextRemissionId: 1,
  inventory: [
    { id: 1, variety: 'Freedom', color: 'Rojo', bunches: 86, stems: 2150, stemsPerBunch: 25, pricePerBunch: 18.5, pricePerStem: 0.74, updatedAt: new Date().toISOString() },
    { id: 2, variety: 'Mondial', color: 'Blanco', bunches: 64, stems: 1600, stemsPerBunch: 25, pricePerBunch: 20, pricePerStem: 0.8, updatedAt: new Date().toISOString() },
    { id: 3, variety: 'Explorer', color: 'Rojo oscuro', bunches: 42, stems: 1050, stemsPerBunch: 25, pricePerBunch: 21.25, pricePerStem: 0.85, updatedAt: new Date().toISOString() },
    { id: 4, variety: 'Pink Floyd', color: 'Rosado', bunches: 37, stems: 925, stemsPerBunch: 25, pricePerBunch: 22.5, pricePerStem: 0.9, updatedAt: new Date().toISOString() },
    { id: 5, variety: 'Tibet', color: 'Blanco', bunches: 29, stems: 725, stemsPerBunch: 25, pricePerBunch: 19.75, pricePerStem: 0.79, updatedAt: new Date().toISOString() }
  ],
  remissions: [],
  transfers: [],
  nextTransferId: 1,
  nextPriceListId: 1,
  priceLists: []
});

const generalPriceKey = '__GENERAL__';

function normalizedText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase();
}

function dateOnly(value = new Date()) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function businessToday() {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: businessTimeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = type => parts.find(item => item.type === type).value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function inventoryStartDate() {
  const [year, month, day] = businessToday().split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day - 1)).toISOString().slice(0, 10);
}

function inventoryKey(item) {
  return Buffer.from(JSON.stringify([
    dateOnly(item.date ?? item.sourceDate ?? item.updatedAt),
    String(item.variety || '').trim(),
    String(item.gradeCm || 'NACIONAL').trim().toUpperCase(),
    Number(item.stemsPerBunch) || 0
  ])).toString('base64url');
}

function decodeInventoryKey(key) {
  try {
    const [sourceDate, variety, gradeCm, stemsPerBunch] = JSON.parse(Buffer.from(String(key), 'base64url').toString('utf8'));
    if (!sourceDate || !variety || !allowedGrades.includes(gradeCm) || !Number(stemsPerBunch)) throw new Error();
    return { sourceDate, variety, gradeCm, stemsPerBunch: Number(stemsPerBunch) };
  } catch {
    throw new Error('La selección de inventario no es válida. Actualice la página e intente nuevamente.');
  }
}

function persistMemory() {
  fs.mkdirSync(dataDirectory, { recursive: true });
  const temporary = `${dataFile}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(memory, null, 2));
  fs.renameSync(temporary, dataFile);
}

async function init() {
  if (!usePostgres) {
    if (fs.existsSync(dataFile)) {
      memory = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
      memory.priceLists ||= [];
      memory.nextPriceListId ||= 1;
      memory.transfers ||= [];
      memory.nextTransferId ||= 1;
    } else {
      memory = initialData();
      persistMemory();
    }
    return;
  }

  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
  });

  await pool.query(`
    CREATE TABLE IF NOT EXISTS inventory (
      id BIGSERIAL PRIMARY KEY,
      variety VARCHAR(120) NOT NULL UNIQUE,
      color VARCHAR(80) NOT NULL DEFAULT '',
      bunches INTEGER NOT NULL DEFAULT 0 CHECK (bunches >= 0),
      stems INTEGER NOT NULL DEFAULT 0 CHECK (stems >= 0),
      stems_per_bunch INTEGER NOT NULL DEFAULT 25 CHECK (stems_per_bunch > 0),
      price_per_bunch NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_per_bunch >= 0),
      price_per_stem NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (price_per_stem >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS remissions (
      id BIGSERIAL PRIMARY KEY,
      remission_number VARCHAR(30) UNIQUE,
      original_remission_number VARCHAR(30),
      client_name VARCHAR(160) NOT NULL,
      client_document VARCHAR(80) NOT NULL DEFAULT '',
      client_phone VARCHAR(50) NOT NULL DEFAULT '',
      destination VARCHAR(160) NOT NULL DEFAULT '',
      delivered_by VARCHAR(160) NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      status VARCHAR(40) NOT NULL DEFAULT 'FINALIZADA',
      requested_bunches INTEGER NOT NULL DEFAULT 0,
      requested_stems INTEGER NOT NULL DEFAULT 0,
      finalized_at TIMESTAMPTZ,
      cancellation_reason TEXT NOT NULL DEFAULT '',
      canceled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS remission_items (
      id BIGSERIAL PRIMARY KEY,
      remission_id BIGINT NOT NULL REFERENCES remissions(id) ON DELETE CASCADE,
      inventory_id BIGINT REFERENCES inventory(id),
      variety VARCHAR(120) NOT NULL,
      source_date DATE,
      grade_cm VARCHAR(40),
      stems_per_bunch INTEGER,
      bunches INTEGER NOT NULL DEFAULT 0 CHECK (bunches >= 0),
      stems INTEGER NOT NULL DEFAULT 0 CHECK (stems >= 0),
      unit_price_bunch NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit_price_stem NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS price_lists (
      id BIGSERIAL PRIMARY KEY,
      client_name VARCHAR(160) NOT NULL DEFAULT '',
      client_key VARCHAR(160) NOT NULL,
      variety VARCHAR(120) NOT NULL,
      grade_cm VARCHAR(40) NOT NULL,
      price_per_bunch NUMERIC(12,2) NOT NULL CHECK (price_per_bunch > 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE(client_key,variety,grade_cm)
    );
    CREATE TABLE IF NOT EXISTS export_transfers (
      id BIGSERIAL PRIMARY KEY,
      variety VARCHAR(120) NOT NULL,
      bunches INTEGER NOT NULL CHECK (bunches > 0),
      stems INTEGER NOT NULL CHECK (stems > 0),
      responsible VARCHAR(160) NOT NULL,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      canceled_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS export_transfer_items (
      id BIGSERIAL PRIMARY KEY,
      transfer_id BIGINT NOT NULL REFERENCES export_transfers(id),
      source_date DATE NOT NULL,
      variety VARCHAR(120) NOT NULL,
      stems_per_bunch INTEGER NOT NULL,
      bunches INTEGER NOT NULL CHECK (bunches > 0)
    );
    ALTER TABLE remission_items ALTER COLUMN inventory_id DROP NOT NULL;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS color VARCHAR(80) NOT NULL DEFAULT '';
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS bunches INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stems INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS stems_per_bunch INTEGER NOT NULL DEFAULT 25;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS price_per_bunch NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS price_per_stem NUMERIC(12,2) NOT NULL DEFAULT 0;
    ALTER TABLE inventory ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
    ALTER TABLE remissions ALTER COLUMN remission_number DROP NOT NULL;
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS original_remission_number VARCHAR(30);
    ALTER TABLE remission_items ADD COLUMN IF NOT EXISTS source_date DATE;
    ALTER TABLE remission_items ADD COLUMN IF NOT EXISTS grade_cm VARCHAR(40);
    ALTER TABLE remission_items ADD COLUMN IF NOT EXISTS stems_per_bunch INTEGER;
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS delivered_by VARCHAR(160) NOT NULL DEFAULT '';
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS status VARCHAR(40) NOT NULL DEFAULT 'FINALIZADA';
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS requested_bunches INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS requested_stems INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS finalized_at TIMESTAMPTZ;
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS cancellation_reason TEXT NOT NULL DEFAULT '';
    ALTER TABLE remissions ADD COLUMN IF NOT EXISTS canceled_at TIMESTAMPTZ;
    UPDATE remissions r SET
      requested_bunches = totals.bunches,
      requested_stems = totals.stems,
      finalized_at = COALESCE(r.finalized_at, r.created_at)
    FROM (
      SELECT remission_id, COALESCE(SUM(bunches),0)::int AS bunches, COALESCE(SUM(stems),0)::int AS stems
      FROM remission_items GROUP BY remission_id
    ) totals
    WHERE r.id = totals.remission_id AND r.requested_bunches = 0;
    CREATE INDEX IF NOT EXISTS idx_remissions_created_at ON remissions(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_remission_items_source ON remission_items(source_date,variety,grade_cm,stems_per_bunch);
    CREATE INDEX IF NOT EXISTS idx_price_lists_lookup ON price_lists(client_key,variety,grade_cm);
    CREATE INDEX IF NOT EXISTS idx_export_transfer_items_source ON export_transfer_items(source_date,variety,stems_per_bunch);
  `);

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM inventory');
  const shouldSeedDemo = process.env.SEED_DEMO_DATA === 'true';
  if (countResult.rows[0].count === 0 && shouldSeedDemo) {
    const seed = initialData().inventory;
    for (const item of seed) {
      await pool.query(
        `INSERT INTO inventory (variety, color, bunches, stems, stems_per_bunch, price_per_bunch, price_per_stem)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (variety) DO NOTHING`,
        [item.variety, item.color, item.bunches, item.stems, item.stemsPerBunch, item.pricePerBunch, item.pricePerStem]
      );
    }
  }
}

function mapInventory(row) {
  return {
    id: Number(row.id),
    variety: row.variety,
    color: row.color,
    bunches: Number(row.bunches),
    stems: Number(row.stems),
    stemsPerBunch: Number(row.stems_per_bunch ?? row.stemsPerBunch),
    pricePerBunch: Number(row.price_per_bunch ?? row.pricePerBunch),
    pricePerStem: Number(row.price_per_stem ?? row.pricePerStem),
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

function mapRemission(row, items = []) {
  return {
    id: Number(row.id),
    remissionNumber: row.remission_number !== undefined ? row.remission_number : (row.remissionNumber ?? null),
    originalRemissionNumber: row.original_remission_number ?? row.originalRemissionNumber ?? null,
    clientName: row.client_name ?? row.clientName,
    clientDocument: row.client_document ?? row.clientDocument,
    clientPhone: row.client_phone ?? row.clientPhone,
    destination: row.destination,
    deliveredBy: row.delivered_by ?? row.deliveredBy ?? '',
    notes: row.notes,
    total: Number(row.total),
    status: row.status || 'FINALIZADA',
    requestedBunches: Number(row.requested_bunches ?? row.requestedBunches ?? 0),
    requestedStems: Number(row.requested_stems ?? row.requestedStems ?? 0),
    finalizedAt: row.finalized_at ?? row.finalizedAt ?? null,
    cancellationReason: row.cancellation_reason ?? row.cancellationReason ?? '',
    canceledAt: row.canceled_at ?? row.canceledAt ?? null,
    createdAt: row.created_at ?? row.createdAt,
    items
  };
}

async function listInventory() {
  if (!usePostgres) {
    return [...memory.inventory].map(item => {
      const normalized = { ...item, date: dateOnly(item.date ?? item.updatedAt), gradeCm: item.gradeCm || 'NACIONAL' };
      return { ...normalized, id: inventoryKey(normalized), key: inventoryKey(normalized) };
    }).filter(item => item.date >= inventoryStartDate()).sort((a, b) => b.date.localeCompare(a.date) || a.variety.localeCompare(b.variety));
  }
  const result = await pool.query(`
    WITH source AS (
      SELECT ts::date AS source_date,
             TRIM(variedad_nombre) AS variety,
             UPPER(TRIM(grado_cm)) AS grade_cm,
             tallos AS stems_per_bunch,
             COUNT(*)::int AS source_bunches,
             SUM(tallos)::int AS source_stems,
             MAX(ts) AS updated_at
      FROM public.scans
      WHERE UPPER(TRIM(grado_cm)) = ANY($1::text[])
        AND ts::date >= ((NOW() AT TIME ZONE $2)::date - 1)
        AND variedad_nombre IS NOT NULL AND TRIM(variedad_nombre) <> ''
        AND tallos IS NOT NULL AND tallos > 0
      GROUP BY ts::date,TRIM(variedad_nombre),UPPER(TRIM(grado_cm)),tallos
    ), used AS (
      SELECT source_date,variety,grade_cm,stems_per_bunch,
             COALESCE(SUM(bunches),0)::int AS used_bunches,
             COALESCE(SUM(stems),0)::int AS used_stems
      FROM remission_items ri
      JOIN remissions r ON r.id = ri.remission_id
      WHERE source_date IS NOT NULL AND r.status <> 'ANULADA'
      GROUP BY source_date,variety,grade_cm,stems_per_bunch
    ), transferred AS (
      SELECT ti.source_date,ti.variety,ti.stems_per_bunch,
             SUM(ti.bunches)::int AS transferred_bunches
      FROM export_transfer_items ti JOIN export_transfers t ON t.id=ti.transfer_id
      WHERE t.canceled_at IS NULL
      GROUP BY ti.source_date,ti.variety,ti.stems_per_bunch
    )
    SELECT source.source_date,source.variety,source.grade_cm,source.stems_per_bunch,source.updated_at,
           GREATEST(source.source_bunches-COALESCE(used.used_bunches,0)-CASE WHEN source.grade_cm='BAJAS' THEN COALESCE(transferred.transferred_bunches,0) ELSE 0 END,0)::int AS bunches,
           GREATEST(source.source_stems-COALESCE(used.used_stems,0)-CASE WHEN source.grade_cm='BAJAS' THEN COALESCE(transferred.transferred_bunches,0)*source.stems_per_bunch ELSE 0 END,0)::int AS stems
    FROM source
    LEFT JOIN used USING (source_date,variety,grade_cm,stems_per_bunch)
    LEFT JOIN transferred ON transferred.source_date=source.source_date AND transferred.variety=source.variety AND transferred.stems_per_bunch=source.stems_per_bunch AND source.grade_cm='BAJAS'
    WHERE source.source_bunches-COALESCE(used.used_bunches,0)-CASE WHEN source.grade_cm='BAJAS' THEN COALESCE(transferred.transferred_bunches,0) ELSE 0 END > 0
    ORDER BY source.source_date DESC,source.variety,source.grade_cm,source.stems_per_bunch
  `, [allowedGrades, businessTimeZone]);
  return result.rows.map(row => {
    const item = {
      date: dateOnly(row.source_date),
      variety: row.variety,
      gradeCm: row.grade_cm,
      stemsPerBunch: Number(row.stems_per_bunch),
      bunches: Number(row.bunches),
      stems: Number(row.stems),
      updatedAt: row.updated_at
    };
    return { ...item, id: inventoryKey(item), key: inventoryKey(item) };
  });
}

async function saveInventory(input) {
  const clean = {
    variety: String(input.variety || '').trim(),
    color: String(input.color || '').trim(),
    bunches: Math.max(0, Number.parseInt(input.bunches, 10) || 0),
    stems: Math.max(0, Number.parseInt(input.stems, 10) || 0),
    stemsPerBunch: Math.max(1, Number.parseInt(input.stemsPerBunch, 10) || 25),
    pricePerBunch: Math.max(0, Number(input.pricePerBunch) || 0),
    pricePerStem: Math.max(0, Number(input.pricePerStem) || 0)
  };
  if (!clean.variety) throw new Error('La variedad es obligatoria.');

  if (!usePostgres) {
    const existing = memory.inventory.find(item => item.variety.toLowerCase() === clean.variety.toLowerCase());
    if (existing) Object.assign(existing, clean, { updatedAt: new Date().toISOString() });
    else memory.inventory.push({ id: memory.nextInventoryId++, ...clean, updatedAt: new Date().toISOString() });
    persistMemory();
    return existing || memory.inventory.at(-1);
  }
  const result = await pool.query(
    `INSERT INTO inventory (variety,color,bunches,stems,stems_per_bunch,price_per_bunch,price_per_stem)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (variety) DO UPDATE SET color=EXCLUDED.color,bunches=EXCLUDED.bunches,stems=EXCLUDED.stems,
       stems_per_bunch=EXCLUDED.stems_per_bunch,price_per_bunch=EXCLUDED.price_per_bunch,
       price_per_stem=EXCLUDED.price_per_stem,updated_at=NOW()
     RETURNING *`,
    [clean.variety, clean.color, clean.bunches, clean.stems, clean.stemsPerBunch, clean.pricePerBunch, clean.pricePerStem]
  );
  return mapInventory(result.rows[0]);
}

async function adjustInventory(id, change) {
  const bunches = Number.parseInt(change.bunches, 10) || 0;
  const stems = Number.parseInt(change.stems, 10) || 0;
  if (!usePostgres) {
    const item = memory.inventory.find(row => row.id === Number(id));
    if (!item) throw new Error('Variedad no encontrada.');
    if (item.bunches + bunches < 0 || item.stems + stems < 0) throw new Error('El ajuste dejaría existencias negativas.');
    item.bunches += bunches;
    item.stems += stems;
    item.updatedAt = new Date().toISOString();
    persistMemory();
    return item;
  }
  const result = await pool.query(
    `UPDATE inventory SET bunches=bunches+$1, stems=stems+$2, updated_at=NOW()
     WHERE id=$3 AND bunches+$1 >= 0 AND stems+$2 >= 0 RETURNING *`,
    [bunches, stems, id]
  );
  if (!result.rows[0]) throw new Error('Variedad no encontrada o el ajuste dejaría existencias negativas.');
  return mapInventory(result.rows[0]);
}

function cleanRemissionInput(input) {
  const details = {
    clientName: String(input.clientName || '').trim(),
    clientDocument: String(input.clientDocument || '').trim(),
    clientPhone: '',
    destination: '',
    deliveredBy: String(input.deliveredBy || '').trim(),
    notes: String(input.notes || '').trim()
  };
  if (!details.clientName) throw new Error('El nombre del cliente es obligatorio.');
  if (!details.deliveredBy) throw new Error('El nombre de quien entrega es obligatorio.');
  const items = (Array.isArray(input.items) ? input.items : []).map(row => {
    if (row.type === 'eucalyptus') {
      const stems = Number(row.stems);
      if (!Number.isSafeInteger(stems) || stems <= 0) throw new Error('Ingrese una cantidad válida de tallos de Eucalipto.');
      return { type: 'eucalyptus', key: 'eucalyptus', stems, bunches: 0 };
    }
    const bunches = Number(row.bunches);
    if (!Number.isSafeInteger(bunches) || bunches <= 0) throw new Error('Ingrese una cantidad válida de ramos.');
    if (row.type === 'export') {
      const variety = String(row.variety || '').trim();
      const gradeCm = String(row.gradeCm || '').trim();
      const stemsPerBunch = Number(row.stemsPerBunch);
      if (!variety || !exportGrades.includes(gradeCm) || !Number.isSafeInteger(stemsPerBunch) || stemsPerBunch <= 0) throw new Error('Revise variedad, grado y tallos por ramo de exportación.');
      return { type: 'export', key: `export:${normalizedText(variety)}:${gradeCm}:${stemsPerBunch}`, variety, gradeCm, stemsPerBunch, bunches };
    }
    const key = String(row.key || '');
    decodeInventoryKey(key);
    return { key, bunches };
  });
  if (!items.length) throw new Error('Agregue al menos una variedad a la remisión.');
  const keys = new Set();
  for (const item of items) {
    if (keys.has(item.key)) throw new Error('Una variedad está repetida en la remisión.');
    keys.add(item.key);
  }
  return { details, items };
}

function cleanPriceInput(input) {
  const clientName = String(input.clientName || '').trim();
  const variety = String(input.variety || '').trim();
  const gradeCm = normalizedText(input.gradeCm);
  const pricePerBunch = Number(input.pricePerBunch);
  if (!variety) throw new Error('Seleccione una variedad.');
  if (normalizedText(variety) === 'EUCALIPTO' ? gradeCm !== 'HOJA' : !priceGrades.includes(gradeCm)) throw new Error('Seleccione un grado válido para esta variedad.');
  if (!(pricePerBunch > 0)) throw new Error(gradeCm === 'HOJA' ? 'Ingrese un precio por tallo mayor que cero.' : 'Ingrese un precio por ramo mayor que cero.');
  return { clientName, clientKey: clientName ? normalizedText(clientName) : generalPriceKey, variety, gradeCm, pricePerBunch };
}

function mapPriceList(row) {
  return {
    id: Number(row.id),
    clientName: row.client_name ?? row.clientName ?? '',
    variety: row.variety,
    gradeCm: row.grade_cm ?? row.gradeCm,
    pricePerBunch: Number(row.price_per_bunch ?? row.pricePerBunch),
    updatedAt: row.updated_at ?? row.updatedAt
  };
}

async function listPriceLists() {
  if (!usePostgres) return [...memory.priceLists].map(mapPriceList).sort((a, b) => a.clientName.localeCompare(b.clientName) || a.variety.localeCompare(b.variety) || a.gradeCm.localeCompare(b.gradeCm));
  const result = await pool.query('SELECT * FROM price_lists ORDER BY client_name,variety,grade_cm');
  return result.rows.map(mapPriceList);
}

async function savePriceList(input) {
  const clean = cleanPriceInput(input);
  if (!usePostgres) {
    const existing = memory.priceLists.find(row => row.clientKey === clean.clientKey && normalizedText(row.variety) === normalizedText(clean.variety) && row.gradeCm === clean.gradeCm);
    const now = new Date().toISOString();
    if (existing) Object.assign(existing, clean, { updatedAt: now });
    else memory.priceLists.push({ id: memory.nextPriceListId++, ...clean, updatedAt: now });
    persistMemory();
    return mapPriceList(existing || memory.priceLists.at(-1));
  }
  const result = await pool.query(
    `INSERT INTO price_lists (client_name,client_key,variety,grade_cm,price_per_bunch)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (client_key,variety,grade_cm) DO UPDATE SET client_name=EXCLUDED.client_name,price_per_bunch=EXCLUDED.price_per_bunch,updated_at=NOW()
     RETURNING *`,
    [clean.clientName, clean.clientKey, clean.variety, clean.gradeCm, clean.pricePerBunch]
  );
  return mapPriceList(result.rows[0]);
}

async function deletePriceList(id) {
  const priceId = Number(id);
  if (!Number.isInteger(priceId) || priceId < 1) throw new Error('El precio seleccionado no es válido.');
  if (!usePostgres) {
    const index = memory.priceLists.findIndex(row => Number(row.id) === priceId);
    if (index < 0) throw new Error('Precio no encontrado.');
    memory.priceLists.splice(index, 1);
    persistMemory();
    return { id: priceId };
  }
  const result = await pool.query('DELETE FROM price_lists WHERE id=$1 RETURNING id', [priceId]);
  if (!result.rows[0]) throw new Error('Precio no encontrado.');
  return { id: Number(result.rows[0].id) };
}

function resolveMemoryPrice(clientName, variety, gradeCm) {
  const clientKey = normalizedText(clientName);
  return memory.priceLists.find(row => row.clientKey === clientKey && normalizedText(row.variety) === normalizedText(variety) && row.gradeCm === gradeCm)
    || memory.priceLists.find(row => row.clientKey === generalPriceKey && normalizedText(row.variety) === normalizedText(variety) && row.gradeCm === gradeCm);
}

function cleanVarietyItems(input) {
  const items = (Array.isArray(input.items) ? input.items : [])
    .map(row => ({ key: String(row.key || ''), bunches: Math.max(0, Number.parseInt(row.bunches, 10) || 0) }))
    .filter(row => row.key && row.bunches > 0);
  if (!items.length) throw new Error('Agregue al menos una variedad a la remisión.');
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.key)) throw new Error('Una variedad está repetida en la remisión.');
    ids.add(item.key);
  }
  return items;
}

function nextNumber(sequence, date = new Date()) {
  return `REM-${date.getFullYear()}-${String(sequence).padStart(5, '0')}`;
}

async function renumberRemissions(client = null) {
  if (!usePostgres) {
    const counts = new Map();
    [...memory.remissions].sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt) || a.id - b.id).forEach(row => {
      row.originalRemissionNumber ||= row.remissionNumber;
      if (row.status === 'ANULADA') { row.remissionNumber = null; return; }
      if (row.status !== 'FINALIZADA') return;
      const year = new Date(row.createdAt).getFullYear();
      const count = (counts.get(year) || 0) + 1;
      counts.set(year, count);
      row.remissionNumber = `REM-${year}-${String(count).padStart(5, '0')}`;
    });
    persistMemory();
    return memory.remissions.map(row => ({ id: row.id, remissionNumber: row.remissionNumber, originalRemissionNumber: row.originalRemissionNumber }));
  }
  const connection = client || await pool.connect();
  try {
    if (!client) await connection.query('BEGIN');
    await connection.query('LOCK TABLE remissions IN EXCLUSIVE MODE');
    const result = await connection.query(`SELECT id,status,remission_number,original_remission_number,
      EXTRACT(YEAR FROM created_at AT TIME ZONE $1)::int AS business_year
      FROM remissions ORDER BY created_at,id`, [businessTimeZone]);
    await connection.query('UPDATE remissions SET original_remission_number=remission_number WHERE original_remission_number IS NULL AND remission_number IS NOT NULL');
    await connection.query("UPDATE remissions SET remission_number=NULL WHERE status='ANULADA'");
    await connection.query("UPDATE remissions SET remission_number='TMP-' || id WHERE status='FINALIZADA'");
    const counts = new Map();
    for (const row of result.rows) {
      if (row.status !== 'FINALIZADA') continue;
      const count = (counts.get(row.business_year) || 0) + 1;
      counts.set(row.business_year, count);
      await connection.query('UPDATE remissions SET remission_number=$1 WHERE id=$2', [`REM-${row.business_year}-${String(count).padStart(5, '0')}`, row.id]);
    }
    if (!client) await connection.query('COMMIT');
    return result.rows.map(row => ({ id: Number(row.id), previousNumber: row.remission_number, status: row.status, businessYear: row.business_year }));
  } catch (error) {
    if (!client) await connection.query('ROLLBACK');
    throw error;
  } finally { if (!client) connection.release(); }
}

function bunchText(value) {
  return `${value} ${Number(value) === 1 ? 'ramo' : 'ramos'}`;
}

async function createRemission(input) {
  const { details, items } = cleanRemissionInput(input);
  if (!usePostgres) {
    const selected = items.map(requested => {
      if (requested.type === 'eucalyptus') return { stock: null, requested, decoded: { variety: 'EUCALIPTO', gradeCm: 'HOJA', stemsPerBunch: 0, sourceDate: null } };
      if (requested.type === 'export') return { stock: null, requested, decoded: { variety: requested.variety, gradeCm: requested.gradeCm, stemsPerBunch: requested.stemsPerBunch, sourceDate: null } };
      const decoded = decodeInventoryKey(requested.key);
      const stock = memory.inventory.find(row => inventoryKey({ ...row, date: dateOnly(row.date ?? row.updatedAt), gradeCm: row.gradeCm || 'NACIONAL' }) === requested.key);
      if (!stock || requested.bunches > stock.bunches) throw new Error(`Stock insuficiente de ${decoded.variety}.`);
      return { stock, requested, decoded };
    });
    const detailRows = selected.map(({ requested, decoded }, index) => {
      const price = resolveMemoryPrice(details.clientName, decoded.variety, decoded.gradeCm);
      if (!price) throw new Error(`No hay precio configurado para ${decoded.variety} · ${decoded.gradeCm}. Regístrelo en Lista de precios.`);
      const unitPriceBunch = Number(price.pricePerBunch);
      return {
        id: index + 1, inventoryId: null, variety: decoded.variety, sourceDate: decoded.sourceDate,
        gradeCm: decoded.gradeCm, stemsPerBunch: decoded.stemsPerBunch, bunches: requested.bunches,
        stems: requested.type === 'eucalyptus' ? requested.stems : requested.bunches * decoded.stemsPerBunch,
        unitPriceBunch: requested.type === 'eucalyptus' ? 0 : unitPriceBunch,
        unitPriceStem: requested.type === 'eucalyptus' ? unitPriceBunch : 0,
        subtotal: requested.type === 'eucalyptus' ? requested.stems * unitPriceBunch : requested.bunches * unitPriceBunch
      };
    });
    const requestedBunches = detailRows.reduce((sum, row) => sum + row.bunches, 0);
    const requestedStems = detailRows.reduce((sum, row) => sum + row.stems, 0);
    const total = detailRows.reduce((sum, row) => sum + row.subtotal, 0);
    const id = memory.nextRemissionId++;
    const now = new Date().toISOString();
    const year = new Date(now).getFullYear();
    const next = memory.remissions.filter(row => row.status === 'FINALIZADA' && new Date(row.createdAt).getFullYear() === year).length + 1;
    const remission = { id, remissionNumber: nextNumber(next), ...details, requestedBunches, requestedStems, total, status: 'FINALIZADA', finalizedAt: now, createdAt: now, items: detailRows };
    selected.forEach(({ stock, requested, decoded }) => { if (stock) { stock.bunches -= requested.bunches; stock.stems -= requested.bunches * decoded.stemsPerBunch; } });
    memory.remissions.unshift(remission);
    persistMemory();
    return remission;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('LOCK TABLE remissions IN EXCLUSIVE MODE');
    const detailRows = [];
    for (const requested of items) {
      const selected = requested.type === 'eucalyptus' ? { variety: 'EUCALIPTO', gradeCm: 'HOJA', stemsPerBunch: 0, sourceDate: null } : requested.type === 'export' ? { variety: requested.variety, gradeCm: requested.gradeCm, stemsPerBunch: requested.stemsPerBunch, sourceDate: null } : decodeInventoryKey(requested.key);
      if (requested.type !== 'export' && requested.type !== 'eucalyptus') {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requested.key]);
        const source = await client.query(`SELECT COUNT(*)::int AS source_bunches FROM public.scans WHERE ts::date=$1::date AND TRIM(variedad_nombre)=$2 AND UPPER(TRIM(grado_cm))=$3 AND tallos=$4`, [selected.sourceDate, selected.variety, selected.gradeCm, selected.stemsPerBunch]);
        const used = await client.query(`SELECT COALESCE(SUM(ri.bunches),0)::int AS used_bunches FROM remission_items ri JOIN remissions r ON r.id=ri.remission_id WHERE ri.source_date=$1::date AND ri.variety=$2 AND ri.grade_cm=$3 AND ri.stems_per_bunch=$4 AND r.status <> 'ANULADA'`, [selected.sourceDate, selected.variety, selected.gradeCm, selected.stemsPerBunch]);
        const transferred = selected.gradeCm === 'BAJAS' ? await client.query(`SELECT COALESCE(SUM(ti.bunches),0)::int AS bunches FROM export_transfer_items ti JOIN export_transfers t ON t.id=ti.transfer_id WHERE ti.source_date=$1::date AND ti.variety=$2 AND ti.stems_per_bunch=$3 AND t.canceled_at IS NULL`, [selected.sourceDate, selected.variety, selected.stemsPerBunch]) : null;
        const available = Number(source.rows[0].source_bunches) - Number(used.rows[0].used_bunches) - Number(transferred?.rows[0].bunches || 0);
        if (requested.bunches > available) throw new Error(`Stock insuficiente de ${selected.variety}. Quedan ${Math.max(available, 0)} ramos.`);
      }
      const priceResult = await client.query(
        `SELECT price_per_bunch FROM price_lists
         WHERE UPPER(TRIM(variety))=UPPER(TRIM($1)) AND grade_cm=$2 AND client_key = ANY($3::text[])
         ORDER BY CASE WHEN client_key=$4 THEN 0 ELSE 1 END LIMIT 1`,
        [selected.variety, selected.gradeCm, [normalizedText(details.clientName), generalPriceKey], normalizedText(details.clientName)]
      );
      if (!priceResult.rows[0]) throw new Error(`No hay precio configurado para ${selected.variety} · ${selected.gradeCm}. Regístrelo en Lista de precios.`);
      const unitPriceBunch = Number(priceResult.rows[0].price_per_bunch);
      const stems = requested.type === 'eucalyptus' ? requested.stems : requested.bunches * selected.stemsPerBunch;
      detailRows.push({ ...selected, bunches: requested.bunches, stems, unitPriceBunch: requested.type === 'eucalyptus' ? 0 : unitPriceBunch, unitPriceStem: requested.type === 'eucalyptus' ? unitPriceBunch : 0, subtotal: (requested.type === 'eucalyptus' ? stems : requested.bunches) * unitPriceBunch });
    }
    const requestedBunches = detailRows.reduce((sum, row) => sum + row.bunches, 0);
    const requestedStems = detailRows.reduce((sum, row) => sum + row.stems, 0);
    const total = detailRows.reduce((sum, row) => sum + row.subtotal, 0);
    const sequenceResult = await client.query("SELECT nextval(pg_get_serial_sequence('remissions','id')) AS id");
    const id = Number(sequenceResult.rows[0].id);
    const businessYear = Number(businessToday().slice(0, 4));
    const numberResult = await client.query("SELECT COUNT(*)::int AS count FROM remissions WHERE status='FINALIZADA' AND EXTRACT(YEAR FROM created_at AT TIME ZONE $1)::int=$2", [businessTimeZone, businessYear]);
    const remissionNumber = `REM-${businessYear}-${String(Number(numberResult.rows[0].count) + 1).padStart(5, '0')}`;
    const header = await client.query(
      `INSERT INTO remissions (id,remission_number,client_name,client_document,client_phone,destination,delivered_by,notes,total,status,requested_bunches,requested_stems,finalized_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'FINALIZADA',$10,$11,NOW()) RETURNING *`,
      [id, remissionNumber, details.clientName, details.clientDocument, details.clientPhone, details.destination, details.deliveredBy, details.notes, total, requestedBunches, requestedStems]
    );
    const savedItems = [];
    for (const row of detailRows) {
      const saved = await client.query(
        `INSERT INTO remission_items (remission_id,inventory_id,variety,source_date,grade_cm,stems_per_bunch,bunches,stems,unit_price_bunch,unit_price_stem,subtotal)
         VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
        [id, row.variety, row.sourceDate, row.gradeCm, row.stemsPerBunch, row.bunches, row.stems, row.unitPriceBunch, row.unitPriceStem, row.subtotal]
      );
      savedItems.push(saved.rows[0]);
    }
    await client.query('COMMIT');
    return mapRemission(header.rows[0], savedItems.map(mapRemissionItem));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function assignRemissionItems(id, input) {
  const items = cleanVarietyItems(input);
  if (!usePostgres) {
    const remission = memory.remissions.find(row => row.id === Number(id));
    if (!remission) throw new Error('Remisión no encontrada.');
    if (remission.status !== 'PENDIENTE_VARIEDADES') throw new Error('Esta remisión ya no está pendiente de variedades.');
    const selected = items.map(requested => {
      const decoded = decodeInventoryKey(requested.key);
      const stock = memory.inventory.find(row => inventoryKey({ ...row, date: dateOnly(row.date ?? row.updatedAt), gradeCm: row.gradeCm || 'NACIONAL' }) === requested.key);
      if (!stock || requested.bunches > stock.bunches) throw new Error(`Stock insuficiente de ${decoded.variety}.`);
      return { stock, requested, decoded };
    });
    const detailRows = selected.map(({ requested, decoded }, index) => ({ id: index + 1, inventoryId: null, variety: decoded.variety, sourceDate: decoded.sourceDate, gradeCm: decoded.gradeCm, stemsPerBunch: decoded.stemsPerBunch, bunches: requested.bunches, stems: requested.bunches * decoded.stemsPerBunch, unitPriceBunch: 0, unitPriceStem: 0, subtotal: 0 }));
    const bunches = detailRows.reduce((sum, row) => sum + row.bunches, 0);
    const stems = detailRows.reduce((sum, row) => sum + row.stems, 0);
    if (bunches > remission.requestedBunches || stems > remission.requestedStems) throw new Error(`La selección no puede superar ${bunchText(remission.requestedBunches)} ni ${remission.requestedStems} tallos.`);
    selected.forEach(({ stock, requested, decoded }) => { stock.bunches -= requested.bunches; stock.stems -= requested.bunches * decoded.stemsPerBunch; });
    remission.items = detailRows; remission.status = 'PENDIENTE_PRECIOS';
    persistMemory();
    return remission;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const header = await client.query('SELECT * FROM remissions WHERE id=$1 FOR UPDATE', [id]);
    if (!header.rows[0]) throw new Error('Remisión no encontrada.');
    if (header.rows[0].status !== 'PENDIENTE_VARIEDADES') throw new Error('Esta remisión ya no está pendiente de variedades.');
    const detailRows = [];
    for (const requested of items) {
      const selected = decodeInventoryKey(requested.key);
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [requested.key]);
      const source = await client.query(`SELECT COUNT(*)::int AS source_bunches FROM public.scans WHERE ts::date=$1::date AND TRIM(variedad_nombre)=$2 AND UPPER(TRIM(grado_cm))=$3 AND tallos=$4`, [selected.sourceDate, selected.variety, selected.gradeCm, selected.stemsPerBunch]);
      const used = await client.query(`SELECT COALESCE(SUM(ri.bunches),0)::int AS used_bunches FROM remission_items ri JOIN remissions r ON r.id=ri.remission_id WHERE ri.source_date=$1::date AND ri.variety=$2 AND ri.grade_cm=$3 AND ri.stems_per_bunch=$4 AND r.status <> 'ANULADA'`, [selected.sourceDate, selected.variety, selected.gradeCm, selected.stemsPerBunch]);
      const transferred = selected.gradeCm === 'BAJAS' ? await client.query(`SELECT COALESCE(SUM(ti.bunches),0)::int AS bunches FROM export_transfer_items ti JOIN export_transfers t ON t.id=ti.transfer_id WHERE ti.source_date=$1::date AND ti.variety=$2 AND ti.stems_per_bunch=$3 AND t.canceled_at IS NULL`, [selected.sourceDate, selected.variety, selected.stemsPerBunch]) : null;
      const available = Number(source.rows[0].source_bunches) - Number(used.rows[0].used_bunches) - Number(transferred?.rows[0].bunches || 0);
      if (requested.bunches > available) throw new Error(`Stock insuficiente de ${selected.variety}. Quedan ${Math.max(available, 0)} ramos.`);
      detailRows.push({ ...selected, bunches: requested.bunches, stems: requested.bunches * selected.stemsPerBunch });
    }
    const bunches = detailRows.reduce((sum, row) => sum + row.bunches, 0);
    const stems = detailRows.reduce((sum, row) => sum + row.stems, 0);
    const expectedBunches = Number(header.rows[0].requested_bunches);
    const expectedStems = Number(header.rows[0].requested_stems);
    if (bunches > expectedBunches || stems > expectedStems) throw new Error(`La selección no puede superar ${bunchText(expectedBunches)} ni ${expectedStems} tallos.`);
    const savedItems = [];
    for (const row of detailRows) {
      const saved = await client.query(`INSERT INTO remission_items (remission_id,inventory_id,variety,source_date,grade_cm,stems_per_bunch,bunches,stems,unit_price_bunch,unit_price_stem,subtotal) VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,0,0,0) RETURNING *`, [id, row.variety, row.sourceDate, row.gradeCm, row.stemsPerBunch, row.bunches, row.stems]);
      savedItems.push(saved.rows[0]);
    }
    const updated = await client.query("UPDATE remissions SET status='PENDIENTE_PRECIOS' WHERE id=$1 RETURNING *", [id]);
    await client.query('COMMIT');
    return mapRemission(updated.rows[0], savedItems.map(mapRemissionItem));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

function mapRemissionItem(row) {
  return { id: Number(row.id), inventoryId: row.inventory_id ? Number(row.inventory_id) : null, variety: row.variety, sourceDate: row.source_date ? dateOnly(row.source_date) : null, gradeCm: row.grade_cm || '', stemsPerBunch: Number(row.stems_per_bunch || 0), bunches: Number(row.bunches), stems: Number(row.stems), unitPriceBunch: Number(row.unit_price_bunch), unitPriceStem: Number(row.unit_price_stem), subtotal: Number(row.subtotal) };
}

async function setRemissionPrices(id, input) {
  const prices = new Map((Array.isArray(input.items) ? input.items : []).map(row => [Number(row.id), Number(row.unitPriceBunch)]));
  if (!usePostgres) {
    const remission = memory.remissions.find(row => row.id === Number(id));
    if (!remission) throw new Error('Remisión no encontrada.');
    if (!['PENDIENTE_PRECIOS', 'FINALIZADA'].includes(remission.status)) throw new Error('Solo se pueden editar precios de remisiones finalizadas.');
    remission.items.forEach(item => { const price = prices.get(Number(item.id)); if (!(price > 0)) throw new Error('Ingrese un precio mayor que cero para cada variedad.'); if (item.gradeCm === 'HOJA') item.unitPriceStem = price; else item.unitPriceBunch = price; item.subtotal = (item.gradeCm === 'HOJA' ? item.stems : item.bunches) * price; });
    remission.total = remission.items.reduce((sum, row) => sum + row.subtotal, 0); remission.status = 'FINALIZADA'; remission.finalizedAt ||= new Date().toISOString();
    persistMemory(); return remission;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const header = await client.query('SELECT * FROM remissions WHERE id=$1 FOR UPDATE', [id]);
    if (!header.rows[0]) throw new Error('Remisión no encontrada.');
    if (!['PENDIENTE_PRECIOS', 'FINALIZADA'].includes(header.rows[0].status)) throw new Error('Solo se pueden editar precios de remisiones finalizadas.');
    const details = await client.query('SELECT * FROM remission_items WHERE remission_id=$1 ORDER BY id FOR UPDATE', [id]);
    if (!details.rows.length) throw new Error('La remisión no tiene variedades asignadas.');
    let total = 0;
    for (const row of details.rows) {
      const price = prices.get(Number(row.id));
      if (!(price > 0)) throw new Error('Ingrese un precio mayor que cero para cada variedad.');
      const subtotal = Number(row.grade_cm === 'HOJA' ? row.stems : row.bunches) * price; total += subtotal;
      await client.query('UPDATE remission_items SET unit_price_bunch=$1, unit_price_stem=$2, subtotal=$3 WHERE id=$4', [row.grade_cm === 'HOJA' ? 0 : price, row.grade_cm === 'HOJA' ? price : 0, subtotal, row.id]);
    }
    const updated = await client.query("UPDATE remissions SET total=$1,status='FINALIZADA',finalized_at=COALESCE(finalized_at,NOW()) WHERE id=$2 RETURNING *", [total, id]);
    const finalItems = await client.query('SELECT * FROM remission_items WHERE remission_id=$1 ORDER BY id', [id]);
    await client.query('COMMIT');
    return mapRemission(updated.rows[0], finalItems.rows.map(mapRemissionItem));
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function cancelRemission(id, input) {
  const reason = String(input.reason || '').trim();
  if (!reason) throw new Error('El motivo de anulación es obligatorio.');
  if (!usePostgres) {
    const remission = memory.remissions.find(row => row.id === Number(id));
    if (!remission) throw new Error('Remisión no encontrada.');
    if (remission.status === 'ANULADA') throw new Error('Esta remisión ya está anulada.');
    if (Array.isArray(remission.items)) {
      for (const item of remission.items) {
        if (!item.sourceDate) continue;
        const stock = memory.inventory.find(row => inventoryKey({ ...row, date: dateOnly(row.date ?? row.updatedAt), gradeCm: row.gradeCm || 'NACIONAL' }) === inventoryKey(item));
        if (stock) { stock.bunches += item.bunches; stock.stems += item.stems; }
      }
    }
    remission.status = 'ANULADA'; remission.cancellationReason = reason; remission.canceledAt = new Date().toISOString();
    await renumberRemissions(); return remission;
  }
  const connection = await pool.connect();
  try {
    await connection.query('BEGIN');
    await connection.query('LOCK TABLE remissions IN EXCLUSIVE MODE');
    const result = await connection.query(
      `UPDATE remissions SET status='ANULADA',cancellation_reason=$1,canceled_at=NOW()
       WHERE id=$2 AND status <> 'ANULADA' RETURNING *`, [reason, id]);
    if (!result.rows[0]) {
      const exists = await connection.query('SELECT status FROM remissions WHERE id=$1', [id]);
      throw new Error(exists.rows[0] ? 'Esta remisión ya está anulada.' : 'Remisión no encontrada.');
    }
    await renumberRemissions(connection);
    await connection.query('COMMIT');
  } catch (error) { await connection.query('ROLLBACK'); throw error; }
  finally { connection.release(); }
  return getRemission(id);
}

function cleanTransferInput(input) {
  const variety = String(input.variety || '').trim();
  const bunches = Number(input.bunches);
  const responsible = String(input.responsible || '').trim();
  const reason = String(input.reason || '').trim();
  if (!variety) throw new Error('Seleccione una variedad de Bajas.');
  if (!Number.isInteger(bunches) || bunches < 1) throw new Error('Ingrese una cantidad válida de ramos.');
  if (!responsible) throw new Error('Ingrese el responsable del traslado.');
  if (!reason) throw new Error('Ingrese el motivo del traslado.');
  return { variety, bunches, responsible, reason };
}

async function listExportTransfers(limit = 100) {
  if (!usePostgres) return [...memory.transfers].reverse().slice(0, limit);
  const result = await pool.query('SELECT id,variety,bunches,stems,responsible,reason,created_at,canceled_at FROM export_transfers ORDER BY created_at DESC,id DESC LIMIT $1', [limit]);
  return result.rows.map(row => ({ id: Number(row.id), variety: row.variety, bunches: Number(row.bunches), stems: Number(row.stems), responsible: row.responsible, reason: row.reason, createdAt: row.created_at, canceledAt: row.canceled_at }));
}

async function createExportTransfer(input) {
  const clean = cleanTransferInput(input);
  const candidates = (await listInventory()).filter(row => row.gradeCm === 'BAJAS' && normalizedText(row.variety) === normalizedText(clean.variety)).sort((a, b) => a.date.localeCompare(b.date) || a.stemsPerBunch - b.stemsPerBunch);
  if (!usePostgres) {
    let pending = clean.bunches;
    const items = [];
    for (const row of candidates) {
      const stock = memory.inventory.find(item => inventoryKey({ ...item, date: dateOnly(item.date ?? item.updatedAt), gradeCm: item.gradeCm || 'NACIONAL' }) === row.key);
      const use = Math.min(pending, stock?.bunches || 0);
      if (use) { items.push({ key: row.key, bunches: use, stems: use * row.stemsPerBunch }); pending -= use; }
    }
    if (pending) throw new Error(`No hay suficientes ramos de Bajas. Disponibles: ${clean.bunches - pending}.`);
    items.forEach(item => { const stock = memory.inventory.find(row => inventoryKey({ ...row, date: dateOnly(row.date ?? row.updatedAt), gradeCm: row.gradeCm || 'NACIONAL' }) === item.key); stock.bunches -= item.bunches; stock.stems -= item.stems; });
    const transfer = { id: memory.nextTransferId++, variety: clean.variety, bunches: clean.bunches, stems: items.reduce((sum, row) => sum + row.stems, 0), responsible: clean.responsible, reason: clean.reason, createdAt: new Date().toISOString(), canceledAt: null, items };
    memory.transfers.push(transfer); persistMemory(); return transfer;
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    let pending = clean.bunches;
    const items = [];
    for (const row of candidates) {
      if (!pending) break;
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [row.key]);
      const stock = await client.query(`SELECT
        (SELECT COUNT(*)::int FROM public.scans WHERE ts::date=$1::date AND TRIM(variedad_nombre)=$2 AND UPPER(TRIM(grado_cm))='BAJAS' AND tallos=$3) AS source_bunches,
        (SELECT COALESCE(SUM(ri.bunches),0)::int FROM remission_items ri JOIN remissions r ON r.id=ri.remission_id WHERE ri.source_date=$1::date AND ri.variety=$2 AND ri.grade_cm='BAJAS' AND ri.stems_per_bunch=$3 AND r.status <> 'ANULADA') AS used_bunches,
        (SELECT COALESCE(SUM(ti.bunches),0)::int FROM export_transfer_items ti JOIN export_transfers t ON t.id=ti.transfer_id WHERE ti.source_date=$1::date AND ti.variety=$2 AND ti.stems_per_bunch=$3 AND t.canceled_at IS NULL) AS transferred_bunches`, [row.date, row.variety, row.stemsPerBunch]);
      const available = Math.max(0, Number(stock.rows[0].source_bunches) - Number(stock.rows[0].used_bunches) - Number(stock.rows[0].transferred_bunches));
      const use = Math.min(pending, available);
      if (use) { items.push({ sourceDate: row.date, variety: row.variety, stemsPerBunch: row.stemsPerBunch, bunches: use }); pending -= use; }
    }
    if (pending) throw new Error(`No hay suficientes ramos de Bajas. Disponibles: ${clean.bunches - pending}. Actualice el inventario.`);
    const stems = items.reduce((sum, row) => sum + row.bunches * row.stemsPerBunch, 0);
    const header = await client.query('INSERT INTO export_transfers (variety,bunches,stems,responsible,reason) VALUES ($1,$2,$3,$4,$5) RETURNING *', [clean.variety, clean.bunches, stems, clean.responsible, clean.reason]);
    for (const item of items) await client.query('INSERT INTO export_transfer_items (transfer_id,source_date,variety,stems_per_bunch,bunches) VALUES ($1,$2,$3,$4,$5)', [header.rows[0].id, item.sourceDate, item.variety, item.stemsPerBunch, item.bunches]);
    await client.query('COMMIT');
    return { id: Number(header.rows[0].id), variety: clean.variety, bunches: clean.bunches, stems, responsible: clean.responsible, reason: clean.reason, createdAt: header.rows[0].created_at, canceledAt: null };
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}

async function cancelExportTransfer(id) {
  const transferId = Number(id);
  if (!Number.isInteger(transferId) || transferId < 1) throw new Error('Traslado no válido.');
  if (!usePostgres) {
    const transfer = memory.transfers.find(row => row.id === transferId);
    if (!transfer || transfer.canceledAt) throw new Error('Traslado no encontrado o ya anulado.');
    transfer.items.forEach(item => { const stock = memory.inventory.find(row => inventoryKey({ ...row, date: dateOnly(row.date ?? row.updatedAt), gradeCm: row.gradeCm || 'NACIONAL' }) === item.key); if (stock) { stock.bunches += item.bunches; stock.stems += item.stems; } });
    transfer.canceledAt = new Date().toISOString(); persistMemory(); return transfer;
  }
  const result = await pool.query('UPDATE export_transfers SET canceled_at=NOW() WHERE id=$1 AND canceled_at IS NULL RETURNING *', [transferId]);
  if (!result.rows[0]) throw new Error('Traslado no encontrado o ya anulado.');
  return { id: transferId, canceledAt: result.rows[0].canceled_at };
}

async function listRemissions(limit = 100) {
  if (!usePostgres) return memory.remissions.slice(0, limit);
  const result = await pool.query('SELECT * FROM remissions ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows.map(row => mapRemission(row));
}

async function getRemission(id) {
  if (!usePostgres) return memory.remissions.find(row => row.id === Number(id)) || null;
  const [header, details] = await Promise.all([
    pool.query('SELECT * FROM remissions WHERE id=$1', [id]),
    pool.query('SELECT * FROM remission_items WHERE remission_id=$1 ORDER BY id', [id])
  ]);
  if (!header.rows[0]) return null;
  const items = details.rows.map(mapRemissionItem);
  return mapRemission(header.rows[0], items);
}

async function dashboard() {
  const [inventory, remissions] = await Promise.all([listInventory(), listRemissions(8)]);
  return {
    totals: {
      varieties: new Set(inventory.map(row => row.variety)).size,
      bunches: inventory.reduce((sum, row) => sum + row.bunches, 0),
      stems: inventory.reduce((sum, row) => sum + row.stems, 0),
      todaySales: remissions.filter(row => row.status === 'FINALIZADA' && new Date(row.createdAt).toDateString() === new Date().toDateString()).reduce((sum, row) => sum + row.total, 0)
    },
    inventory,
    remissions
  };
}

async function salesReport(from, to) {
  const start = String(from || '').slice(0, 10);
  const end = String(to || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || start > end) throw new Error('Seleccione un rango de fechas válido.');
  if (!usePostgres) {
    return memory.remissions.filter(row => row.status === 'FINALIZADA' && dateOnly(row.createdAt) >= start && dateOnly(row.createdAt) <= end).flatMap(remission => (remission.items || []).map(item => ({ remissionNumber: remission.remissionNumber, createdAt: remission.createdAt, clientName: remission.clientName, ...item })));
  }
  const result = await pool.query(`
    SELECT r.remission_number,r.created_at,r.client_name,
           ri.variety,ri.grade_cm,ri.bunches,ri.stems,ri.unit_price_bunch,ri.unit_price_stem,ri.subtotal
    FROM remissions r
    JOIN remission_items ri ON ri.remission_id=r.id
    WHERE r.status='FINALIZADA'
      AND (r.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date
    ORDER BY r.created_at DESC,ri.variety`, [start, end, businessTimeZone]);
  return result.rows.map(row => ({ remissionNumber: row.remission_number, createdAt: row.created_at, clientName: row.client_name, variety: row.variety, gradeCm: row.grade_cm, bunches: Number(row.bunches), stems: Number(row.stems), unitPriceBunch: Number(row.unit_price_bunch), unitPriceStem: Number(row.unit_price_stem), subtotal: Number(row.subtotal) }));
}

module.exports = { init, listInventory, saveInventory, adjustInventory, listPriceLists, savePriceList, deletePriceList, createRemission, assignRemissionItems, setRemissionPrices, cancelRemission, renumberRemissions, listExportTransfers, createExportTransfer, cancelExportTransfer, listRemissions, getRemission, dashboard, salesReport, usePostgres };
