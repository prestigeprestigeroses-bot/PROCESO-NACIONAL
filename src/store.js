const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

const usePostgres = Boolean(process.env.DATABASE_URL);
const dataDirectory = path.join(process.cwd(), '.data');
const dataFile = path.join(dataDirectory, 'flor-data.json');

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
  remissions: []
});

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
      remission_number VARCHAR(30) NOT NULL UNIQUE,
      client_name VARCHAR(160) NOT NULL,
      client_document VARCHAR(80) NOT NULL DEFAULT '',
      client_phone VARCHAR(50) NOT NULL DEFAULT '',
      destination VARCHAR(160) NOT NULL DEFAULT '',
      notes TEXT NOT NULL DEFAULT '',
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS remission_items (
      id BIGSERIAL PRIMARY KEY,
      remission_id BIGINT NOT NULL REFERENCES remissions(id) ON DELETE CASCADE,
      inventory_id BIGINT NOT NULL REFERENCES inventory(id),
      variety VARCHAR(120) NOT NULL,
      bunches INTEGER NOT NULL DEFAULT 0 CHECK (bunches >= 0),
      stems INTEGER NOT NULL DEFAULT 0 CHECK (stems >= 0),
      unit_price_bunch NUMERIC(12,2) NOT NULL DEFAULT 0,
      unit_price_stem NUMERIC(12,2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_remissions_created_at ON remissions(created_at DESC);
  `);

  const countResult = await pool.query('SELECT COUNT(*)::int AS count FROM inventory');
  const shouldSeedDemo = process.env.SEED_DEMO_DATA === 'true' || process.env.NODE_ENV !== 'production';
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
    remissionNumber: row.remission_number ?? row.remissionNumber,
    clientName: row.client_name ?? row.clientName,
    clientDocument: row.client_document ?? row.clientDocument,
    clientPhone: row.client_phone ?? row.clientPhone,
    destination: row.destination,
    notes: row.notes,
    total: Number(row.total),
    createdAt: row.created_at ?? row.createdAt,
    items
  };
}

async function listInventory() {
  if (!usePostgres) return [...memory.inventory].sort((a, b) => a.variety.localeCompare(b.variety));
  const result = await pool.query('SELECT * FROM inventory ORDER BY variety');
  return result.rows.map(mapInventory);
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
    clientPhone: String(input.clientPhone || '').trim(),
    destination: String(input.destination || '').trim(),
    notes: String(input.notes || '').trim()
  };
  if (!details.clientName) throw new Error('El nombre del cliente es obligatorio.');
  const items = (Array.isArray(input.items) ? input.items : [])
    .map(row => ({ id: Number(row.id), bunches: Math.max(0, Number.parseInt(row.bunches, 10) || 0), stems: Math.max(0, Number.parseInt(row.stems, 10) || 0) }))
    .filter(row => row.id && (row.bunches > 0 || row.stems > 0));
  if (!items.length) throw new Error('Agregue al menos una variedad a la remisión.');
  const ids = new Set();
  for (const item of items) {
    if (ids.has(item.id)) throw new Error('Una variedad está repetida en la remisión.');
    ids.add(item.id);
  }
  return { details, items };
}

function nextNumber(sequence, date = new Date()) {
  return `REM-${date.getFullYear()}-${String(sequence).padStart(5, '0')}`;
}

async function createRemission(input) {
  const { details, items } = cleanRemissionInput(input);
  if (!usePostgres) {
    const selected = items.map(requested => {
      const stock = memory.inventory.find(row => row.id === requested.id);
      if (!stock) throw new Error('Una de las variedades ya no existe.');
      if (requested.bunches > stock.bunches || requested.stems > stock.stems) throw new Error(`Stock insuficiente de ${stock.variety}.`);
      return { stock, requested };
    });
    const remissionItems = selected.map(({ stock, requested }) => ({
      inventoryId: stock.id,
      variety: stock.variety,
      bunches: requested.bunches,
      stems: requested.stems,
      unitPriceBunch: stock.pricePerBunch,
      unitPriceStem: stock.pricePerStem,
      subtotal: requested.bunches * stock.pricePerBunch + requested.stems * stock.pricePerStem
    }));
    const total = remissionItems.reduce((sum, row) => sum + row.subtotal, 0);
    const id = memory.nextRemissionId++;
    const remission = { id, remissionNumber: nextNumber(id), ...details, total, createdAt: new Date().toISOString(), items: remissionItems };
    selected.forEach(({ stock, requested }) => {
      stock.bunches -= requested.bunches;
      stock.stems -= requested.stems;
      stock.updatedAt = new Date().toISOString();
    });
    memory.remissions.unshift(remission);
    persistMemory();
    return remission;
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const inventoryRows = [];
    for (const requested of items) {
      const result = await client.query('SELECT * FROM inventory WHERE id=$1 FOR UPDATE', [requested.id]);
      const stock = result.rows[0] && mapInventory(result.rows[0]);
      if (!stock) throw new Error('Una de las variedades ya no existe.');
      if (requested.bunches > stock.bunches || requested.stems > stock.stems) throw new Error(`Stock insuficiente de ${stock.variety}.`);
      inventoryRows.push({ stock, requested });
    }
    const sequenceResult = await client.query("SELECT nextval(pg_get_serial_sequence('remissions','id')) AS id");
    const id = Number(sequenceResult.rows[0].id);
    const remissionNumber = nextNumber(id);
    const detailRows = inventoryRows.map(({ stock, requested }) => ({
      inventoryId: stock.id, variety: stock.variety, bunches: requested.bunches, stems: requested.stems,
      unitPriceBunch: stock.pricePerBunch, unitPriceStem: stock.pricePerStem,
      subtotal: requested.bunches * stock.pricePerBunch + requested.stems * stock.pricePerStem
    }));
    const total = detailRows.reduce((sum, row) => sum + row.subtotal, 0);
    const remissionResult = await client.query(
      `INSERT INTO remissions (id,remission_number,client_name,client_document,client_phone,destination,notes,total)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, remissionNumber, details.clientName, details.clientDocument, details.clientPhone, details.destination, details.notes, total]
    );
    for (const row of detailRows) {
      await client.query(
        `INSERT INTO remission_items (remission_id,inventory_id,variety,bunches,stems,unit_price_bunch,unit_price_stem,subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [id, row.inventoryId, row.variety, row.bunches, row.stems, row.unitPriceBunch, row.unitPriceStem, row.subtotal]
      );
      await client.query('UPDATE inventory SET bunches=bunches-$1, stems=stems-$2, updated_at=NOW() WHERE id=$3', [row.bunches, row.stems, row.inventoryId]);
    }
    await client.query('COMMIT');
    return mapRemission(remissionResult.rows[0], detailRows);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
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
  const items = details.rows.map(row => ({
    inventoryId: Number(row.inventory_id), variety: row.variety, bunches: Number(row.bunches), stems: Number(row.stems),
    unitPriceBunch: Number(row.unit_price_bunch), unitPriceStem: Number(row.unit_price_stem), subtotal: Number(row.subtotal)
  }));
  return mapRemission(header.rows[0], items);
}

async function dashboard() {
  const [inventory, remissions] = await Promise.all([listInventory(), listRemissions(8)]);
  return {
    totals: {
      varieties: inventory.length,
      bunches: inventory.reduce((sum, row) => sum + row.bunches, 0),
      stems: inventory.reduce((sum, row) => sum + row.stems, 0),
      todaySales: remissions.filter(row => new Date(row.createdAt).toDateString() === new Date().toDateString()).reduce((sum, row) => sum + row.total, 0)
    },
    inventory,
    remissions
  };
}

module.exports = { init, listInventory, saveInventory, adjustInventory, createRemission, listRemissions, getRemission, dashboard, usePostgres };
