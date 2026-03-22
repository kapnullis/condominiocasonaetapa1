// database/init.js
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const bcrypt = require('bcryptjs');

// Usar variable de entorno DB_PATH si está definida, si no, ruta local por defecto
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'database.sqlite');
const DB_DIR = path.dirname(DB_PATH);

// Crear el directorio si no existe
if (!fs.existsSync(DB_DIR)) {
  fs.mkdirSync(DB_DIR, { recursive: true });
}

function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('❌ Error al conectar a la BD:', err);
        reject(err);
        return;
      }
      console.log('✅ Conectado a la base de datos SQLite.');
    });

    db.serialize(() => {
      // Tabla grupos
      db.run(`CREATE TABLE IF NOT EXISTS grupos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        nombre TEXT NOT NULL UNIQUE
      )`);

      // Tabla propietarios (con saldo_favor)
      db.run(`CREATE TABLE IF NOT EXISTS propietarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        apartamento TEXT NOT NULL UNIQUE,
        nombre TEXT NOT NULL,
        telefono TEXT,
        email TEXT,
        grupo_id INTEGER,
        saldo_favor REAL DEFAULT 0,
        FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE SET NULL
      )`);

      // Tabla usuarios
      db.run(`CREATE TABLE IF NOT EXISTS usuarios (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL UNIQUE,
        password TEXT NOT NULL,
        rol TEXT NOT NULL CHECK(rol IN ('master', 'propietario')),
        propietario_id INTEGER UNIQUE,
        FOREIGN KEY (propietario_id) REFERENCES propietarios(id) ON DELETE CASCADE
      )`);

      // Tabla deudas (con original_monto)
      db.run(`CREATE TABLE IF NOT EXISTS deudas (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        propietario_id INTEGER NOT NULL,
        periodo TEXT NOT NULL,
        monto_usd REAL NOT NULL,
        fecha_vencimiento TEXT,
        pagado BOOLEAN DEFAULT 0,
        fecha_pago TEXT,
        referencia_pago TEXT,
        original_monto REAL,
        FOREIGN KEY (propietario_id) REFERENCES propietarios(id) ON DELETE CASCADE
      )`);

      // Si la tabla ya existía sin original_monto, agregar la columna
      db.run(`ALTER TABLE deudas ADD COLUMN original_monto REAL`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.warn('No se pudo añadir original_monto:', err.message);
        } else {
          console.log('✅ Columna original_monto añadida (si no existía)');
        }
      });

      // Tabla recibos
      db.run(`CREATE TABLE IF NOT EXISTS recibos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        periodo TEXT NOT NULL,
        monto_usd REAL NOT NULL,
        grupo_id INTEGER,
        fecha_creacion TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (grupo_id) REFERENCES grupos(id) ON DELETE CASCADE
      )`);

      // Tabla pagos
      db.run(`CREATE TABLE IF NOT EXISTS pagos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        propietario_id INTEGER NOT NULL,
        fecha_pago TEXT,
        monto_bs REAL,
        tasa_bcv REAL,
        monto_usd REAL,
        referencia TEXT,
        imagen_ruta TEXT,
        estado TEXT DEFAULT 'pendiente' CHECK(estado IN ('pendiente', 'verificado')),
        fecha_registro TEXT DEFAULT CURRENT_TIMESTAMP,
        fecha_verificacion TEXT,
        FOREIGN KEY (propietario_id) REFERENCES propietarios(id) ON DELETE CASCADE
      )`);

      // Asegurar que la columna saldo_favor existe (para BD antiguas)
      db.run(`ALTER TABLE propietarios ADD COLUMN saldo_favor REAL DEFAULT 0`, (err) => {
        if (err && !err.message.includes('duplicate column')) {
          console.warn('No se pudo añadir saldo_favor:', err.message);
        }
      });
    });

    // Crear usuario master
    const masterUsername = 'admin';
    const masterPassword = 'admin123';
    const hash = bcrypt.hashSync(masterPassword, 10);

    db.get('SELECT id FROM usuarios WHERE username = ?', [masterUsername], (err, row) => {
      if (err) console.error('Error al buscar master:', err);
      else if (!row) {
        db.run('INSERT INTO usuarios (username, password, rol) VALUES (?, ?, ?)',
          [masterUsername, hash, 'master'],
          (err) => { if (err) console.error('Error al crear master:', err); else console.log('✅ Usuario master creado: admin / admin123'); });
      } else console.log('ℹ️ Usuario master ya existe');
    });

    db.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

module.exports = initDatabase;