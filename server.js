// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { load } = require('cheerio');
const https = require('https');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'tu_secreto_muy_seguro_cambiar_en_produccion';

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Redirigir raíz a login
app.get('/', (req, res) => {
  res.redirect('/login.html');
});

// Middleware para verificar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No autenticado' });
  }

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(403).json({ error: 'Token inválido o expirado' });
    }
    req.user = user;
    next();
  });
}

// ---------- Configuración de PostgreSQL ----------
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Función auxiliar para ejecutar consultas
async function query(text, params) {
  const client = await pool.connect();
  try {
    const res = await client.query(text, params);
    return res;
  } finally {
    client.release();
  }
}

// ---------- Inicialización de la base de datos ----------
async function initDatabase() {
  // Crear tablas si no existen (usando sintaxis PostgreSQL)
  await query(`
    CREATE TABLE IF NOT EXISTS grupos (
      id SERIAL PRIMARY KEY,
      nombre TEXT NOT NULL UNIQUE
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS propietarios (
      id SERIAL PRIMARY KEY,
      apartamento TEXT NOT NULL UNIQUE,
      nombre TEXT NOT NULL,
      telefono TEXT,
      email TEXT,
      grupo_id INTEGER REFERENCES grupos(id) ON DELETE SET NULL,
      saldo_favor REAL DEFAULT 0
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id SERIAL PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password TEXT NOT NULL,
      rol TEXT NOT NULL CHECK(rol IN ('master', 'propietario')),
      propietario_id INTEGER UNIQUE REFERENCES propietarios(id) ON DELETE CASCADE
    )
  `);

  await query(`
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
    )
  `);

  await query(`
    CREATE TABLE IF NOT EXISTS recibos (
      id SERIAL PRIMARY KEY,
      periodo TEXT NOT NULL,
      monto_usd REAL NOT NULL,
      grupo_id INTEGER REFERENCES grupos(id) ON DELETE CASCADE,
      fecha_creacion TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await query(`
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
      fecha_verificacion TEXT
    )
  `);

  // Asegurar que la columna original_monto existe (para compatibilidad)
  try {
    await query(`ALTER TABLE deudas ADD COLUMN IF NOT EXISTS original_monto REAL`);
  } catch (e) { /* columna ya existe */ }

  try {
    await query(`ALTER TABLE propietarios ADD COLUMN IF NOT EXISTS saldo_favor REAL DEFAULT 0`);
  } catch (e) { /* columna ya existe */ }

  // Crear usuario master si no existe
  const masterUsername = 'admin';
  const masterPassword = 'admin123';
  const hash = bcrypt.hashSync(masterPassword, 10);
  const existing = await query('SELECT id FROM usuarios WHERE username = $1', [masterUsername]);
  if (existing.rows.length === 0) {
    await query('INSERT INTO usuarios (username, password, rol) VALUES ($1, $2, $3)', [masterUsername, hash, 'master']);
    console.log('✅ Usuario master creado: admin / admin123');
  } else {
    console.log('ℹ️ Usuario master ya existe');
  }
}

// ---------- Función para obtener tasa BCV (sin cambios) ----------
async function obtenerTasaBCV() {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.bcv.org.ve',
      port: 443,
      path: '/',
      method: 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Encoding': 'gzip, deflate, br'
      },
      rejectUnauthorized: false,
      agent: new https.Agent({ rejectUnauthorized: false })
    };
    const req = https.request(options, res => {
      let chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => {
        let buffer = Buffer.concat(chunks);
        const encoding = res.headers["content-encoding"];
        try {
          if (encoding === "gzip") buffer = zlib.gunzipSync(buffer);
          else if (encoding === "deflate") buffer = zlib.inflateSync(buffer);
          else if (encoding === "br") buffer = zlib.brotliDecompressSync(buffer);
          const html = buffer.toString("utf8");
          const $ = load(html);
          const tasaOficialText = $('#dolar > div:nth-child(1) > div:nth-child(1) > div:nth-child(2) > strong:nth-child(1)').text().trim();
          const fecha = $('.pull-right > span:nth-child(1)').text().trim();
          const tasaOficial = parseFloat(tasaOficialText.replace(',', '.').replace(/[^\d.-]/g, ''));
          if (isNaN(tasaOficial)) reject(new Error("No se pudo obtener la tasa del BCV"));
          else resolve({ tasa: tasaOficial, fecha });
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// ---------- Rutas API ----------

// Autenticación
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const result = await query('SELECT * FROM usuarios WHERE username = $1', [username]);
    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }
    const valid = bcrypt.compareSync(password, user.password);
    if (valid) {
      const token = jwt.sign(
        { id: user.id, rol: user.rol, propietario_id: user.propietario_id, usuario_id: user.id },
        JWT_SECRET,
        { expiresIn: '1d' }
      );
      res.json({ success: true, token, rol: user.rol, propietario_id: user.propietario_id, usuario_id: user.id });
    } else {
      res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: 'Error interno' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.json({ success: true });
});

// Tasa BCV
app.get('/api/tasa-bcv', async (req, res) => {
  try {
    const tasa = await obtenerTasaBCV();
    res.json(tasa);
  } catch (err) {
    res.status(500).json({ error: 'No se pudo obtener la tasa BCV' });
  }
});

// ---------- Grupos ----------
app.get('/api/grupos', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM grupos ORDER BY nombre');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/grupos', authenticateToken, async (req, res) => {
  const { nombre } = req.body;
  try {
    const result = await query('INSERT INTO grupos (nombre) VALUES ($1) RETURNING id', [nombre]);
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  try {
    await query('UPDATE grupos SET nombre = $1 WHERE id = $2', [nombre, id]);
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await query('UPDATE propietarios SET grupo_id = NULL WHERE grupo_id = $1', [id]);
    const result = await query('DELETE FROM grupos WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/grupos/:id/asignar', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere lista de IDs de propietarios' });
  }
  try {
    const placeholders = ids.map((_, i) => `$${i+2}`).join(',');
    const queryText = `UPDATE propietarios SET grupo_id = $1 WHERE id IN (${placeholders})`;
    await query(queryText, [id, ...ids]);
    res.json({ changes: ids.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Propietarios ----------
app.get('/api/propietarios', authenticateToken, async (req, res) => {
  try {
    const result = await query('SELECT * FROM propietarios ORDER BY id');
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/propietarios/saldo', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*,
             COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = false), 0) as total_deuda,
             (p.saldo_favor - COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = false), 0)) as saldo_neto
      FROM propietarios p
      ORDER BY p.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM propietarios WHERE id = $1', [id]);
    if (result.rows.length === 0) return res.status(404).json({ error: 'No encontrado' });
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/propietarios', authenticateToken, async (req, res) => {
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  try {
    const result = await query(
      'INSERT INTO propietarios (apartamento, nombre, telefono, email, grupo_id, saldo_favor) VALUES ($1, $2, $3, $4, $5, 0) RETURNING id',
      [apartamento, nombre, telefono || null, email || null, grupo_id || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    if (err.message.includes('duplicate key')) {
      return res.status(400).json({ error: 'El apartamento ya existe.' });
    }
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  try {
    await query(
      'UPDATE propietarios SET apartamento = $1, nombre = $2, telefono = $3, email = $4, grupo_id = $5 WHERE id = $6',
      [apartamento, nombre, telefono || null, email || null, grupo_id || null, id]
    );
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM propietarios WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Usuario de propietario
app.get('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM usuarios WHERE propietario_id = $1', [id]);
    res.json(result.rows[0] || null);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  try {
    const result = await query(
      'INSERT INTO usuarios (username, password, rol, propietario_id) VALUES ($1, $2, $3, $4) RETURNING id',
      [username, hash, 'propietario', id]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  try {
    if (password) {
      const hash = bcrypt.hashSync(password, 10);
      await query('UPDATE usuarios SET username = $1, password = $2 WHERE propietario_id = $3', [username, hash, id]);
    } else {
      await query('UPDATE usuarios SET username = $1 WHERE propietario_id = $2', [username, id]);
    }
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Deudas por propietario
app.get('/api/propietarios/:id/deudas', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM deudas WHERE propietario_id = $1 ORDER BY periodo DESC', [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Pagos por propietario
app.get('/api/propietarios/:id/pagos', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('SELECT * FROM pagos WHERE propietario_id = $1 ORDER BY fecha_registro DESC', [id]);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Recibos ----------
app.get('/api/recibos', authenticateToken, async (req, res) => {
  const { grupoId } = req.query;
  let queryText = 'SELECT * FROM recibos';
  const params = [];
  if (grupoId) {
    queryText += ' WHERE grupo_id = $1';
    params.push(grupoId);
  }
  queryText += ' ORDER BY periodo DESC';
  try {
    const result = await query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/recibos', authenticateToken, async (req, res) => {
  const { periodo, monto_usd, grupo_id } = req.body;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reciboResult = await client.query(
      'INSERT INTO recibos (periodo, monto_usd, grupo_id) VALUES ($1, $2, $3) RETURNING id',
      [periodo, monto_usd, grupo_id || null]
    );
    const reciboId = reciboResult.rows[0].id;

    // Obtener propietarios afectados
    let propQuery = 'SELECT id, saldo_favor FROM propietarios';
    const propParams = [];
    if (grupo_id) {
      propQuery += ' WHERE grupo_id = $1';
      propParams.push(grupo_id);
    }
    const propietarios = await client.query(propQuery, propParams);
    const updates = [];
    for (const p of propietarios.rows) {
      let restante = monto_usd;
      let nuevoSaldo = p.saldo_favor;
      let deuda = 0;
      if (nuevoSaldo >= restante) {
        nuevoSaldo -= restante;
        restante = 0;
      } else {
        restante -= nuevoSaldo;
        nuevoSaldo = 0;
        deuda = restante;
      }
      await client.query('UPDATE propietarios SET saldo_favor = $1 WHERE id = $2', [nuevoSaldo, p.id]);
      if (deuda > 0) {
        await client.query(
          'INSERT INTO deudas (propietario_id, periodo, monto_usd) VALUES ($1, $2, $3)',
          [p.id, periodo, deuda]
        );
      }
    }
    await client.query('COMMIT');
    res.json({ id: reciboId });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error(err);
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

app.delete('/api/recibos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM recibos WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Deudas ----------
app.get('/api/deudas', authenticateToken, async (req, res) => {
  const { propietarioId } = req.query;
  let queryText = 'SELECT * FROM deudas';
  const params = [];
  if (propietarioId) {
    queryText += ' WHERE propietario_id = $1';
    params.push(propietarioId);
  }
  queryText += ' ORDER BY periodo DESC';
  try {
    const result = await query(queryText, params);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/deudas', authenticateToken, async (req, res) => {
  const { propietario_id, periodo, monto_usd, fecha_vencimiento } = req.body;
  try {
    const result = await query(
      'INSERT INTO deudas (propietario_id, periodo, monto_usd, fecha_vencimiento) VALUES ($1, $2, $3, $4) RETURNING id',
      [propietario_id, periodo, monto_usd, fecha_vencimiento || null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { periodo, monto_usd, fecha_vencimiento, pagado } = req.body;
  try {
    await query(
      'UPDATE deudas SET periodo = $1, monto_usd = $2, fecha_vencimiento = $3, pagado = $4 WHERE id = $5',
      [periodo, monto_usd, fecha_vencimiento || null, pagado, id]
    );
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM deudas WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Pagos ----------
app.get('/api/pagos/pendientes', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, pr.nombre as propietario_nombre, pr.apartamento
      FROM pagos p
      JOIN propietarios pr ON p.propietario_id = pr.id
      WHERE p.estado = 'pendiente'
      ORDER BY p.fecha_registro DESC
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pagos/:id/verificar', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await verificarPago(id);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pagos/:id/revertir', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await revertirPago(id);
    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/pagos/propietario', authenticateToken, async (req, res) => {
  const { propietario_id, fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const monto_usd = monto_bs / tasa_bcv;
  try {
    const result = await query(
      `INSERT INTO pagos (propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, imagen_ruta, estado) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'pendiente') RETURNING id`,
      [propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, null]
    );
    res.json({ id: result.rows[0].id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const monto_usd = monto_bs / tasa_bcv;
  try {
    await query(
      'UPDATE pagos SET fecha_pago = $1, monto_bs = $2, tasa_bcv = $3, monto_usd = $4, referencia = $5 WHERE id = $6',
      [fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, id]
    );
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const result = await query('DELETE FROM pagos WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Usuarios (master) ----------
app.get('/api/usuarios/existe', authenticateToken, async (req, res) => {
  const { username } = req.query;
  try {
    const result = await query('SELECT id FROM usuarios WHERE username = $1', [username]);
    res.json({ exists: result.rows.length > 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/usuarios', authenticateToken, async (req, res) => {
  try {
    const result = await query(`
      SELECT u.id, u.username, u.rol, u.propietario_id,
             p.nombre as propietario_nombre, p.apartamento
      FROM usuarios u
      LEFT JOIN propietarios p ON u.propietario_id = p.id
      ORDER BY u.id
    `);
    res.json(result.rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  try {
    if (username && username.trim() !== '') {
      const existing = await query('SELECT id FROM usuarios WHERE username = $1 AND id != $2', [username, id]);
      if (existing.rows.length > 0) {
        return res.status(400).json({ error: 'El nombre de usuario ya existe.' });
      }
      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        await query('UPDATE usuarios SET username = $1, password = $2 WHERE id = $3', [username, hash, id]);
      } else {
        await query('UPDATE usuarios SET username = $1 WHERE id = $2', [username, id]);
      }
    } else {
      if (password) {
        const hash = bcrypt.hashSync(password, 10);
        await query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, id]);
      }
    }
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    const user = await query('SELECT username FROM usuarios WHERE id = $1', [id]);
    if (user.rows.length && user.rows[0].username === 'admin') {
      return res.status(403).json({ error: 'No se puede eliminar el usuario master.' });
    }
    const result = await query('DELETE FROM usuarios WHERE id = $1', [id]);
    res.json({ changes: result.rowCount });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put('/api/usuarios/:id/password', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nuevaPassword } = req.body;
  const hash = bcrypt.hashSync(nuevaPassword, 10);
  try {
    await query('UPDATE usuarios SET password = $1 WHERE id = $2', [hash, id]);
    res.json({ changes: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Funciones auxiliares para pagos ----------
async function verificarPago(pagoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pagoResult = await client.query('SELECT * FROM pagos WHERE id = $1', [pagoId]);
    const pago = pagoResult.rows[0];
    if (!pago) throw new Error('Pago no encontrado');
    if (pago.estado !== 'pendiente') throw new Error('El pago ya fue verificado');

    let montoUSD = pago.monto_usd;
    if (!montoUSD || montoUSD <= 0) {
      if (pago.monto_bs && pago.tasa_bcv) {
        montoUSD = pago.monto_bs / pago.tasa_bcv;
      } else {
        throw new Error('No se puede calcular el monto en USD. Faltan datos.');
      }
    }
    if (montoUSD <= 0) throw new Error('El monto del pago debe ser positivo');

    const deudasResult = await client.query(
      'SELECT * FROM deudas WHERE propietario_id = $1 AND pagado = false ORDER BY periodo',
      [pago.propietario_id]
    );
    const deudas = deudasResult.rows;
    let restante = montoUSD;
    const updates = [];

    for (const deuda of deudas) {
      if (restante <= 0) break;
      if (restante >= deuda.monto_usd) {
        updates.push(client.query(
          'UPDATE deudas SET pagado = true, fecha_pago = $1, referencia_pago = $2, original_monto = COALESCE(original_monto, monto_usd) WHERE id = $3',
          [pago.fecha_pago, pago.referencia, deuda.id]
        ));
        restante -= deuda.monto_usd;
      } else {
        updates.push(client.query(
          'UPDATE deudas SET monto_usd = $1, fecha_pago = $2, referencia_pago = $3, original_monto = COALESCE(original_monto, monto_usd) WHERE id = $4',
          [deuda.monto_usd - restante, pago.fecha_pago, pago.referencia, deuda.id]
        ));
        restante = 0;
        break;
      }
    }

    let saldoFavor = 0;
    if (restante > 0) {
      saldoFavor = restante;
      updates.push(client.query(
        'UPDATE propietarios SET saldo_favor = saldo_favor + $1 WHERE id = $2',
        [saldoFavor, pago.propietario_id]
      ));
    }

    await Promise.all(updates);
    await client.query(
      'UPDATE pagos SET estado = $1, fecha_verificacion = CURRENT_TIMESTAMP, monto_usd = $2 WHERE id = $3',
      ['verificado', montoUSD, pagoId]
    );
    await client.query('COMMIT');
    return { changes: 1, saldo_favor: saldoFavor };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function revertirPago(pagoId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const pagoResult = await client.query('SELECT * FROM pagos WHERE id = $1', [pagoId]);
    const pago = pagoResult.rows[0];
    if (!pago) throw new Error('Pago no encontrado');
    if (pago.estado !== 'verificado') throw new Error('El pago no está verificado');

    const montoUSD = pago.monto_usd;
    if (!montoUSD || montoUSD <= 0) throw new Error('El pago no tiene monto en USD calculado');

    const deudasResult = await client.query(
      `SELECT id, monto_usd, original_mongo 
       FROM deudas 
       WHERE propietario_id = $1 AND fecha_pago = $2 AND referencia_pago = $3`,
      [pago.propietario_id, pago.fecha_pago, pago.referencia]
    );
    const deudas = deudasResult.rows;
    if (deudas.length === 0) throw new Error('No se encontraron deudas asociadas a este pago.');

    const updates = [];
    for (const deuda of deudas) {
      const montoRestaurado = deuda.original_monto || deuda.monto_usd;
      updates.push(client.query(
        'UPDATE deudas SET pagado = false, monto_usd = $1, fecha_pago = NULL, referencia_pago = NULL, original_monto = NULL WHERE id = $2',
        [montoRestaurado, deuda.id]
      ));
    }
    updates.push(client.query(
      'UPDATE propietarios SET saldo_favor = saldo_favor - $1 WHERE id = $2',
      [montoUSD, pago.propietario_id]
    ));
    updates.push(client.query(
      'UPDATE pagos SET estado = $1, fecha_verificacion = NULL WHERE id = $2',
      ['pendiente', pagoId]
    ));

    await Promise.all(updates);
    await client.query('COMMIT');
    return { changes: 1 };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

// ---------- Iniciar servidor ----------
initDatabase().then(() => {
  app.listen(PORT, () => {
    console.log(`Servidor corriendo en http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error('Error al inicializar BD:', err);
  process.exit(1);
});
