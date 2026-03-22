// server.js
const express = require('express');
const cors = require('cors');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { load } = require('cheerio');
const https = require('https');
const zlib = require('zlib');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'tu_secreto_muy_seguro_cambiar_en_produccion'; // CAMBIAR EN PRODUCCIÓN

// Middleware
app.use(cors({
  origin: 'http://localhost:3000',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// Middleware para verificar token JWT
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer TOKEN"
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

// ---------- Base de datos ----------
function openDB() {
  const dbPath = path.join(__dirname, 'database', 'database.sqlite');
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) reject(err);
      else resolve(db);
    });
  });
}

const initDatabase = require('./database/init');

// ---------- Función para obtener tasa BCV ----------
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

// ---------- Rutas ----------

// Autenticación
app.post('/api/auth/login', async (req, res) => {
  const { username, password } = req.body;
  const db = await openDB();
  db.get('SELECT * FROM usuarios WHERE username = ?', [username], (err, user) => {
    db.close();
    if (err) {
      console.error(err);
      return res.status(500).json({ success: false, message: 'Error interno' });
    }
    if (!user) {
      return res.status(401).json({ success: false, message: 'Usuario no encontrado' });
    }
    const valid = bcrypt.compareSync(password, user.password);
    if (valid) {
      const token = jwt.sign(
        {
          id: user.id,
          rol: user.rol,
          propietario_id: user.propietario_id,
          usuario_id: user.id
        },
        JWT_SECRET,
        { expiresIn: '1d' }
      );
      res.json({
        success: true,
        token,
        rol: user.rol,
        propietario_id: user.propietario_id,
        usuario_id: user.id
      });
    } else {
      res.status(401).json({ success: false, message: 'Contraseña incorrecta' });
    }
  });
});

app.post('/api/auth/logout', (req, res) => {
  // El logout se maneja en el frontend eliminando el token.
  res.json({ success: true });
});

// Tasa BCV (pública)
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
  const db = await openDB();
  db.all('SELECT * FROM grupos ORDER BY nombre', (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/grupos', authenticateToken, async (req, res) => {
  const { nombre } = req.body;
  const db = await openDB();
  db.run('INSERT INTO grupos (nombre) VALUES (?)', [nombre], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ id: this.lastID });
  });
});

app.put('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nombre } = req.body;
  const db = await openDB();
  db.run('UPDATE grupos SET nombre = ? WHERE id = ?', [nombre, id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

app.delete('/api/grupos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.run('UPDATE propietarios SET grupo_id = NULL WHERE grupo_id = ?', [id], (err) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: err.message });
    }
    db.run('DELETE FROM grupos WHERE id = ?', [id], function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ changes: this.changes });
    });
  });
});

app.post('/api/grupos/:id/asignar', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) {
    return res.status(400).json({ error: 'Se requiere lista de IDs de propietarios' });
  }
  const db = await openDB();
  const placeholders = ids.map(() => '?').join(',');
  const sql = `UPDATE propietarios SET grupo_id = ? WHERE id IN (${placeholders})`;
  const params = [id, ...ids];
  db.run(sql, params, function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// ---------- Propietarios ----------
app.get('/api/propietarios', authenticateToken, async (req, res) => {
  const db = await openDB();
  db.all('SELECT * FROM propietarios ORDER BY id', (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/propietarios/saldo', authenticateToken, async (req, res) => {
  const db = await openDB();
  db.all(`
    SELECT p.*, 
           COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = 0), 0) as total_deuda,
           (p.saldo_favor - COALESCE((SELECT SUM(monto_usd) FROM deudas WHERE propietario_id = p.id AND pagado = 0), 0)) as saldo_neto
    FROM propietarios p
    ORDER BY p.id
  `, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.get('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.get('SELECT * FROM propietarios WHERE id = ?', [id], (err, row) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    if (!row) return res.status(404).json({ error: 'No encontrado' });
    res.json(row);
  });
});

app.post('/api/propietarios', authenticateToken, async (req, res) => {
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  const db = await openDB();
  db.run(
    'INSERT INTO propietarios (apartamento, nombre, telefono, email, grupo_id, saldo_favor) VALUES (?, ?, ?, ?, ?, ?)',
    [apartamento, nombre, telefono, email, grupo_id || null, 0],
    function(err) {
      db.close();
      if (err) {
        if (err.message.includes('UNIQUE constraint failed: propietarios.apartamento')) {
          return res.status(400).json({ error: 'El apartamento ya existe.' });
        }
        return res.status(500).json({ error: err.message });
      }
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { apartamento, nombre, telefono, email, grupo_id } = req.body;
  const db = await openDB();
  db.run(
    'UPDATE propietarios SET apartamento = ?, nombre = ?, telefono = ?, email = ?, grupo_id = ? WHERE id = ?',
    [apartamento, nombre, telefono, email, grupo_id || null, id],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ changes: this.changes });
    }
  );
});

app.delete('/api/propietarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.run('DELETE FROM propietarios WHERE id = ?', [id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// Usuario de propietario
app.get('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.get('SELECT * FROM usuarios WHERE propietario_id = ?', [id], (err, row) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(row || null);
  });
});

app.post('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const hash = bcrypt.hashSync(password, 10);
  const db = await openDB();
  db.run(
    'INSERT INTO usuarios (username, password, rol, propietario_id) VALUES (?, ?, ?, ?)',
    [username, hash, 'propietario', id],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/propietarios/:id/usuario', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const db = await openDB();
  let query = 'UPDATE usuarios SET username = ? WHERE propietario_id = ?';
  let params = [username, id];
  if (password) {
    const hash = bcrypt.hashSync(password, 10);
    query = 'UPDATE usuarios SET username = ?, password = ? WHERE propietario_id = ?';
    params = [username, hash, id];
  }
  db.run(query, params, function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// Deudas por propietario
app.get('/api/propietarios/:id/deudas', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.all('SELECT * FROM deudas WHERE propietario_id = ? ORDER BY periodo DESC', [id], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Pagos por propietario
app.get('/api/propietarios/:id/pagos', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.all('SELECT * FROM pagos WHERE propietario_id = ? ORDER BY fecha_registro DESC', [id], (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// ---------- Recibos ----------
app.get('/api/recibos', authenticateToken, async (req, res) => {
  const { grupoId } = req.query;
  const db = await openDB();
  let query = 'SELECT * FROM recibos';
  let params = [];
  if (grupoId) {
    query += ' WHERE grupo_id = ?';
    params.push(grupoId);
  }
  query += ' ORDER BY periodo DESC';
  db.all(query, params, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/recibos', authenticateToken, async (req, res) => {
  const { periodo, monto_usd, grupo_id } = req.body;
  const db = await openDB();
  db.run('INSERT INTO recibos (periodo, monto_usd, grupo_id) VALUES (?, ?, ?)', [periodo, monto_usd, grupo_id || null], function(err) {
    if (err) {
      db.close();
      return res.status(500).json({ error: err.message });
    }
    const reciboId = this.lastID;

    let query = 'SELECT id, saldo_favor FROM propietarios';
    let params = [];
    if (grupo_id) {
      query += ' WHERE grupo_id = ?';
      params.push(grupo_id);
    }
    db.all(query, params, (err, propietarios) => {
      if (err) {
        db.close();
        return res.status(500).json({ error: err.message });
      }
      const updates = propietarios.map(p => {
        return new Promise((resolve, reject) => {
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
          db.run('UPDATE propietarios SET saldo_favor = ? WHERE id = ?', [nuevoSaldo, p.id], (err) => {
            if (err) return reject(err);
            if (deuda > 0) {
              db.run('INSERT INTO deudas (propietario_id, periodo, monto_usd) VALUES (?, ?, ?)', [p.id, periodo, deuda], (err) => {
                if (err) reject(err);
                else resolve();
              });
            } else {
              resolve();
            }
          });
        });
      });
      Promise.all(updates).then(() => {
        db.close();
        res.json({ id: reciboId });
      }).catch(err => {
        db.close();
        res.status(500).json({ error: err.message });
      });
    });
  });
});

app.delete('/api/recibos/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.run('DELETE FROM recibos WHERE id = ?', [id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// ---------- Deudas ----------
app.get('/api/deudas', authenticateToken, async (req, res) => {
  const { propietarioId } = req.query;
  const db = await openDB();
  let query = 'SELECT * FROM deudas';
  let params = [];
  if (propietarioId) {
    query += ' WHERE propietario_id = ?';
    params.push(propietarioId);
  }
  query += ' ORDER BY periodo DESC';
  db.all(query, params, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.post('/api/deudas', authenticateToken, async (req, res) => {
  const { propietario_id, periodo, monto_usd, fecha_vencimiento } = req.body;
  const db = await openDB();
  db.run(
    'INSERT INTO deudas (propietario_id, periodo, monto_usd, fecha_vencimiento) VALUES (?, ?, ?, ?)',
    [propietario_id, periodo, monto_usd, fecha_vencimiento || null],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { periodo, monto_usd, fecha_vencimiento, pagado } = req.body;
  const db = await openDB();
  db.run(
    'UPDATE deudas SET periodo = ?, monto_usd = ?, fecha_vencimiento = ?, pagado = ? WHERE id = ?',
    [periodo, monto_usd, fecha_vencimiento || null, pagado ? 1 : 0, id],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ changes: this.changes });
    }
  );
});

app.delete('/api/deudas/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.run('DELETE FROM deudas WHERE id = ?', [id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// ---------- Pagos ----------
app.get('/api/pagos/pendientes', authenticateToken, async (req, res) => {
  const db = await openDB();
  db.all(`
    SELECT p.*, pr.nombre as propietario_nombre, pr.apartamento
    FROM pagos p
    JOIN propietarios pr ON p.propietario_id = pr.id
    WHERE p.estado = 'pendiente'
    ORDER BY p.fecha_registro DESC
  `, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
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
  const db = await openDB();
  db.run(
    `INSERT INTO pagos (propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, imagen_ruta, estado) 
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [propietario_id, fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, null, 'pendiente'],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

app.put('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { fecha_pago, monto_bs, tasa_bcv, referencia } = req.body;
  const monto_usd = monto_bs / tasa_bcv;
  const db = await openDB();
  db.run(
    'UPDATE pagos SET fecha_pago = ?, monto_bs = ?, tasa_bcv = ?, monto_usd = ?, referencia = ? WHERE id = ?',
    [fecha_pago, monto_bs, tasa_bcv, monto_usd, referencia, id],
    function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ changes: this.changes });
    }
  );
});

app.delete('/api/pagos/propietario/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.run('DELETE FROM pagos WHERE id = ?', [id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// ---------- Usuarios (master) ----------
app.get('/api/usuarios/existe', authenticateToken, async (req, res) => {
  const { username } = req.query;
  const db = await openDB();
  db.get('SELECT id FROM usuarios WHERE username = ?', [username], (err, row) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ exists: !!row });
  });
});

app.get('/api/usuarios', authenticateToken, async (req, res) => {
  const db = await openDB();
  db.all(`
    SELECT u.id, u.username, u.rol, u.propietario_id,
           p.nombre as propietario_nombre, p.apartamento
    FROM usuarios u
    LEFT JOIN propietarios p ON u.propietario_id = p.id
    ORDER BY u.id
  `, (err, rows) => {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

app.put('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { username, password } = req.body;
  const db = await openDB();
  db.serialize(() => {
    if (username && username.trim() !== '') {
      db.get('SELECT id FROM usuarios WHERE username = ? AND id != ?', [username, id], (err, existing) => {
        if (err) {
          db.close();
          return res.status(500).json({ error: err.message });
        }
        if (existing) {
          db.close();
          return res.status(400).json({ error: 'El nombre de usuario ya existe.' });
        }
        const query = password ? 'UPDATE usuarios SET username = ?, password = ? WHERE id = ?' : 'UPDATE usuarios SET username = ? WHERE id = ?';
        const params = password ? [username, bcrypt.hashSync(password, 10), id] : [username, id];
        db.run(query, params, function(err) {
          db.close();
          if (err) return res.status(500).json({ error: err.message });
          res.json({ changes: this.changes });
        });
      });
    } else {
      if (password) {
        db.run('UPDATE usuarios SET password = ? WHERE id = ?', [bcrypt.hashSync(password, 10), id], function(err) {
          db.close();
          if (err) return res.status(500).json({ error: err.message });
          res.json({ changes: this.changes });
        });
      } else {
        db.close();
        res.json({ changes: 0 });
      }
    }
  });
});

app.delete('/api/usuarios/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const db = await openDB();
  db.get('SELECT username FROM usuarios WHERE id = ?', [id], (err, user) => {
    if (err) {
      db.close();
      return res.status(500).json({ error: err.message });
    }
    if (user && user.username === 'admin') {
      db.close();
      return res.status(403).json({ error: 'No se puede eliminar el usuario master.' });
    }
    db.run('DELETE FROM usuarios WHERE id = ?', [id], function(err) {
      db.close();
      if (err) return res.status(500).json({ error: err.message });
      res.json({ changes: this.changes });
    });
  });
});

app.put('/api/usuarios/:id/password', authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { nuevaPassword } = req.body;
  const hash = bcrypt.hashSync(nuevaPassword, 10);
  const db = await openDB();
  db.run('UPDATE usuarios SET password = ? WHERE id = ?', [hash, id], function(err) {
    db.close();
    if (err) return res.status(500).json({ error: err.message });
    res.json({ changes: this.changes });
  });
});

// ---------- Funciones auxiliares para pagos ----------
async function verificarPago(pagoId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.get('SELECT * FROM pagos WHERE id = ?', [pagoId], (err, pago) => {
        if (err) return reject(err);
        if (!pago) return reject(new Error('Pago no encontrado'));
        if (pago.estado !== 'pendiente') return reject(new Error('El pago ya fue verificado'));

        let montoUSD = pago.monto_usd;
        if (!montoUSD || montoUSD <= 0) {
          if (pago.monto_bs && pago.tasa_bcv) {
            montoUSD = pago.monto_bs / pago.tasa_bcv;
          } else {
            return reject(new Error('No se puede calcular el monto en USD. Faltan datos.'));
          }
        }
        if (montoUSD <= 0) return reject(new Error('El monto del pago debe ser positivo'));

        db.all('SELECT * FROM deudas WHERE propietario_id = ? AND pagado = 0 ORDER BY periodo', [pago.propietario_id], (err, deudas) => {
          if (err) return reject(err);

          let restante = montoUSD;
          const updates = [];

          for (let i = 0; i < deudas.length; i++) {
            const deuda = deudas[i];
            if (restante <= 0) break;

            if (restante >= deuda.monto_usd) {
              updates.push(new Promise((res, rej) => {
                db.run(
                  'UPDATE deudas SET pagado = 1, fecha_pago = ?, referencia_pago = ?, original_monto = COALESCE(original_monto, monto_usd) WHERE id = ?',
                  [pago.fecha_pago, pago.referencia, deuda.id],
                  (err) => {
                    if (err) rej(err); else res();
                  }
                );
              }));
              restante -= deuda.monto_usd;
            } else {
              updates.push(new Promise((res, rej) => {
                db.run(
                  'UPDATE deudas SET monto_usd = ?, fecha_pago = ?, referencia_pago = ?, original_monto = COALESCE(original_monto, monto_usd) WHERE id = ?',
                  [deuda.monto_usd - restante, pago.fecha_pago, pago.referencia, deuda.id],
                  (err) => {
                    if (err) rej(err); else res();
                  }
                );
              }));
              restante = 0;
              break;
            }
          }

          let saldoFavor = 0;
          if (restante > 0) {
            saldoFavor = restante;
            updates.push(new Promise((res, rej) => {
              db.run('UPDATE propietarios SET saldo_favor = saldo_favor + ? WHERE id = ?', [saldoFavor, pago.propietario_id], (err) => {
                if (err) rej(err); else res();
              });
            }));
          }

          Promise.all(updates).then(() => {
            db.run(
              `UPDATE pagos SET estado = 'verificado', fecha_verificacion = datetime('now'), monto_usd = ? WHERE id = ?`,
              [montoUSD, pagoId],
              function(err) {
                db.close();
                if (err) reject(err);
                else resolve({ changes: this.changes, saldo_favor: saldoFavor });
              }
            );
          }).catch(reject);
        });
      });
    });
  });
}

async function revertirPago(pagoId) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    db.get('SELECT * FROM pagos WHERE id = ?', [pagoId], (err, pago) => {
      if (err) return reject(err);
      if (!pago) return reject(new Error('Pago no encontrado'));
      if (pago.estado !== 'verificado') return reject(new Error('El pago no está verificado'));

      const montoUSD = pago.monto_usd;
      if (!montoUSD || montoUSD <= 0) return reject(new Error('El pago no tiene monto en USD calculado'));

      db.all(`
        SELECT id, monto_usd, original_monto 
        FROM deudas 
        WHERE propietario_id = ? AND fecha_pago = ? AND referencia_pago = ?
      `, [pago.propietario_id, pago.fecha_pago, pago.referencia], (err, deudas) => {
        if (err) return reject(err);
        if (deudas.length === 0) return reject(new Error('No se encontraron deudas asociadas a este pago.'));

        const updates = [];
        for (const deuda of deudas) {
          const montoRestaurado = deuda.original_monto || deuda.monto_usd;
          updates.push(new Promise((res, rej) => {
            db.run(
              'UPDATE deudas SET pagado = 0, monto_usd = ?, fecha_pago = NULL, referencia_pago = NULL, original_monto = NULL WHERE id = ?',
              [montoRestaurado, deuda.id],
              (err) => { if (err) rej(err); else res(); }
            );
          }));
        }

        updates.push(new Promise((res, rej) => {
          db.run('UPDATE propietarios SET saldo_favor = saldo_favor - ? WHERE id = ?', [montoUSD, pago.propietario_id], (err) => {
            if (err) rej(err); else res();
          });
        }));

        Promise.all(updates).then(() => {
          db.run('UPDATE pagos SET estado = ?, fecha_verificacion = NULL WHERE id = ?',
            ['pendiente', pagoId], function(err) {
              db.close();
              if (err) reject(err);
              else resolve({ changes: this.changes });
            });
        }).catch(reject);
      });
    });
  });
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