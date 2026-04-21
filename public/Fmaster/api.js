// public/Fmaster/api.js
// Cliente API centralizado con manejo de autenticación

const API_BASE = '/api';

/**
 * Realiza una petición HTTP a la API con manejo automático de token y errores.
 * @param {string} endpoint - Ruta del endpoint (ej: '/grupos')
 * @param {string} method - Método HTTP (GET, POST, PUT, DELETE)
 * @param {object|null} body - Cuerpo de la petición para POST/PUT
 * @returns {Promise<any>} Respuesta parseada como JSON
 */
export async function fetchAPI(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };

  if (body) {
    options.body = JSON.stringify(body);
  }

  const res = await fetch(`${API_BASE}${endpoint}`, options);

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      localStorage.removeItem('rol');
      window.location.href = '/login.html';
      throw new Error('Sesión expirada o no autorizado');
    }

    let errorMsg = `Error ${res.status}`;
    try {
      const errorData = await res.json();
      errorMsg = errorData.error || errorMsg;
    } catch (e) {
      // Si no es JSON, usar texto
      try {
        const text = await res.text();
        if (text) errorMsg = text;
      } catch (e2) {}
    }
    throw new Error(errorMsg);
  }

  // Manejar respuesta vacía (ej: DELETE exitoso)
  const text = await res.text();
  if (!text) return null;
  return JSON.parse(text);
}

// Objeto que agrupa todas las operaciones de la API
export const api = {
  // Grupos
  getGrupos: () => fetchAPI('/grupos'),

  // Propietarios
  getPropietarios: () => fetchAPI('/propietarios'),
  getPropietariosConSaldo: () => fetchAPI('/propietarios/saldo'),
  getPropietarioById: (id) => fetchAPI(`/propietarios/${id}`),

  // Recibos
  addRecibo: (recibo) => fetchAPI('/recibos', 'POST', recibo),
  getRecibos: (grupoId) => fetchAPI('/recibos' + (grupoId ? `?grupoId=${grupoId}` : '')),
  getReciboById: (id) => fetchAPI(`/recibos/${id}`),

  // Deudas
  addDeuda: (deuda) => fetchAPI('/deudas', 'POST', deuda),
  getDeudasByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/deudas`),
  deleteDeuda: (id) => fetchAPI(`/deudas/${id}`, 'DELETE'),

  // Pagos
  getPagosPendientes: () => fetchAPI('/pagos/pendientes'),
  verificarPago: (pagoId) => fetchAPI(`/pagos/${pagoId}/verificar`, 'POST'),

  // Tasa BCV
  getTasaBCV: () => fetchAPI('/tasa-bcv')
};