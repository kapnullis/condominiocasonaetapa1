// database/init.js (versión PostgreSQL)
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

// Detectamos si la conexión es local para evitar SSL en desarrollo
const isLocal = process.env.DATABASE_URL && (
  process.env.DATABASE_URL.includes('localhost') ||
  process.env.DATABASE_URL.includes('127.0.0.1')
);

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: isLocal ? false : { rejectUnauthorized: false }   // ← FIX: SSL siempre activo en producción
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    // Crear tablas si no existen
    await client.query(`
      CREATE TABLE IF NOT EXISTS grupos (
        id SERIAL PRIMARY KEY,
        nombre TEXT NOT NULL UNIQUE
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS propietarios (
        id SERIAL PRIMARY KEY,
        apartamento TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        telefono TEXT,
        email TEXT,
        grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL,
        saldo_favor REAL DEFAULT 0
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        rol TEXT NOT NULL CHECK(rol IN ('master', 'propietario')),
        propietario_id INTEGER UNIQUE REFERENCES propietarios(id) ON DELETE CASCADE
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS deudas (
        id SERIAL PRIMARY KEY,
        propietario_id INTEGER NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
        periodo TEXT NOT NULL,
        monto_usd REAL NOT NULL,
        fecha_vencimiento TEXT,
        pagado BOOLEAN DEFAULT false,
        fecha_pago TEXT,
        referencia_pago TEXT,
        original_monto REAL
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS recibos (
        id SERIAL PRIMARY KEY,
        periodo TEXT NOT NULL,
        monto_usd REAL NOT NULL,
        grupo_id INTEGER REFERENCES grupos(id) ON DELETE CASCADE,
        fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);
    await client.query(`
      CREATE TABLE IF NOT EXISTS pagos (
        id SERIAL PRIMARY KEY,
        propietario_id INTEGER NOT NULL REFERENCES propietarios(id) ON DELETE CASCADE,
        fecha_pago TEXT,
        monto_bs REAL,
        tasa_bcv REAL,
        monto_usd REAL,
        referencia TEXT,
        imagen_ruta TEXT,
        estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'verificado')),
        fecha_registro TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fecha_verificacion TIMESTAMP
      );
    `);

    // Crear usuario master si no existe
    const masterUsername = 'admin';
    const masterPassword = 'admin123';
    const hash = bcrypt.hashSync(masterPassword, 10);
    const result = await client.query('SELECT id FROM usuarios WHERE username = $1', [masterUsername]);
    if (result.rows.length === 0) {
      await client.query(
        'INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)',
        [masterUsername, hash, 'master']
      );
      console.log('✅ Usuario master creado: admin / admin123');
    } else {
      console.log('ℹ️ Usuario master ya existe');
    }
  } finally {
    client.release();
  }
}

module.exports = initDatabase;
