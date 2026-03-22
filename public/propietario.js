// public/propietario.js
console.log('Panel de propietario cargado');

// Configuración base de la API
const API_BASE = '/api';

// Obtener parámetros de la URL (propietarioId y usuarioId)
const urlParams = new URLSearchParams(window.location.search);
const propietarioId = urlParams.get('propietarioId');
const usuarioId = urlParams.get('usuarioId');

console.log('propietarioId desde URL:', propietarioId);
console.log('usuarioId desde URL:', usuarioId);

if (!propietarioId) {
  alert('No se encontró información de propietario');
  window.location.href = '/login.html';
  throw new Error('No hay propietarioId');
}

let propietarioActual = null;
let deudasPendientes = [];

// ---------- Función fetch con token JWT ----------
async function fetchAPI(endpoint, method = 'GET', body = null) {
  const token = localStorage.getItem('token');
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    }
  };
  if (body) options.body = JSON.stringify(body);
  const res = await fetch(`${API_BASE}${endpoint}`, options);
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) {
      localStorage.removeItem('token');
      window.location.href = '/login.html';
      throw new Error('Sesión expirada');
    }
    let errorMsg = `Error ${res.status}`;
    try {
      const errorData = await res.json();
      errorMsg = errorData.error || errorMsg;
    } catch (e) {}
    throw new Error(errorMsg);
  }
  return await res.json();
}

// ---------- API ----------
const api = {
  // Propietario
  getPropietarioById: (id) => fetchAPI(`/propietarios/${id}`),
  getDeudasByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/deudas`),
  getPagosByPropietario: (propietarioId) => fetchAPI(`/propietarios/${propietarioId}/pagos`),

  // Pagos (propietario)
  crearPagoPropietario: (datos) => fetchAPI('/pagos/propietario', 'POST', datos),
  updatePagoPropietario: (datos) => fetchAPI(`/pagos/propietario/${datos.id}`, 'PUT', datos),
  deletePagoPropietario: (pagoId) => fetchAPI(`/pagos/propietario/${pagoId}`, 'DELETE'),

  // Tasa BCV
  getTasaBCV: () => fetchAPI('/tasa-bcv'),

  // Cambiar contraseña
  cambiarPassword: (usuarioId, nuevaPassword) => fetchAPI(`/usuarios/${usuarioId}/password`, 'PUT', { nuevaPassword })
};

// ----- Funciones de UI -----
async function cargarDatos() {
  try {
    propietarioActual = await api.getPropietarioById(parseInt(propietarioId));
    if (!propietarioActual) throw new Error('Propietario no encontrado');

    document.getElementById('propietarioNombre').textContent = propietarioActual.nombre;
    document.getElementById('propietarioApartamento').textContent = propietarioActual.apartamento;
    document.getElementById('propietarioEmail').textContent = propietarioActual.email || '—';
    document.getElementById('propietarioTelefono').textContent = propietarioActual.telefono || '—';

    await cargarDeudas();
    await cargarPagos();

    const totalDeudasPendientes = deudasPendientes.reduce((sum, d) => sum + d.monto_usd, 0);
    const saldoNeto = (propietarioActual.saldo_favor || 0) - totalDeudasPendientes;
    const saldoEstadoElement = document.getElementById('saldoEstado');
    if (saldoEstadoElement) {
      const esSaldoAFavor = saldoNeto >= 0;
      const texto = esSaldoAFavor ? 'Saldo a favor' : 'Deuda pendiente';
      const valor = Math.abs(saldoNeto).toFixed(2);
      saldoEstadoElement.textContent = `${texto}: $${valor}`;
      saldoEstadoElement.style.color = esSaldoAFavor ? 'green' : 'red';
    }
  } catch (err) {
    console.error(err);
    alert('Error al cargar datos: ' + err.message);
    window.location.href = '/login.html';
  }
}

async function cargarDeudas() {
  const tbody = document.querySelector('#tablaDeudas tbody');
  if (!tbody) return;
  try {
    const deudas = await api.getDeudasByPropietario(parseInt(propietarioId));
    deudasPendientes = deudas.filter(d => !d.pagado);
    tbody.innerHTML = '';
    deudasPendientes.forEach(d => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
          <td>${d.periodo}</td>
          <td>$${d.monto_usd.toFixed(2)}</td>
          <td>${d.fecha_vencimiento || '—'}</td>
          <td class="pendiente">Pendiente</td>
      `;
      tbody.appendChild(tr);
    });
    if (deudasPendientes.length === 0) {
      tbody.innerHTML = '<td colspan="4">No hay deudas pendientes.</td>';
    }
  } catch (err) {
    console.error('Error cargando deudas:', err);
  }
}

async function cargarPagos() {
  const tbody = document.querySelector('#tablaPagos tbody');
  if (!tbody) return;
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    tbody.innerHTML = '';
    pagos.forEach(p => {
      const tr = document.createElement('tr');
      const montoUSD = p.monto_bs && p.tasa_bcv ? (p.monto_bs / p.tasa_bcv).toFixed(2) : '—';
      const isVerified = p.estado === 'verificado';
      tr.innerHTML = `
          <td>${p.fecha_pago || '—'}</td>
          <td>${p.monto_bs ? p.monto_bs.toFixed(2) : '—'}</td>
          <td>${p.tasa_bcv ? p.tasa_bcv.toFixed(2) : '—'}</td>
          <td>${montoUSD}</td>
          <td>${p.referencia || '—'}</td>
          <td class="${isVerified ? 'verificado' : 'pendiente'}">${p.estado}</td>
          <td>${p.fecha_verificacion || '—'}</td>
          <td class="acciones-pago">
            ${!isVerified ? `<button class="btn-editar" onclick="editarPago(${p.id})">Editar</button>
            <button class="btn-eliminar" onclick="eliminarPago(${p.id})">Eliminar</button>` : '—'}
          </td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error cargando pagos:', err);
  }
}

// ----- Modal de Pago (Agregar/Editar) -----
const modalPago = document.getElementById('modalPago');
const modalPagoTitulo = document.getElementById('modalPagoTitulo');
const formPago = document.getElementById('formPago');
const btnAgregarPago = document.getElementById('btnAgregarPago');
const spanClosePago = document.querySelector('#modalPago .close');

async function cargarTasaBCV() {
  const tasaDiv = document.getElementById('tasaActual');
  const tasaInput = document.getElementById('tasaPago');
  try {
    tasaDiv.textContent = 'Obteniendo tasa BCV...';
    const tasaData = await api.getTasaBCV();
    tasaInput.value = tasaData.tasa.toFixed(2);
    tasaDiv.textContent = `Tasa BCV actual: ${tasaData.tasa.toFixed(2)} Bs/USD (${tasaData.fecha})`;
  } catch (err) {
    console.error('Error al obtener tasa BCV:', err);
    tasaDiv.textContent = 'No se pudo obtener la tasa automáticamente. Ingresa la tasa manualmente.';
    tasaInput.value = '';
  }
}

function resetFormPago() {
  document.getElementById('pagoId').value = '';
  const hoy = new Date().toISOString().split('T')[0];
  document.getElementById('fechaPago').value = hoy;
  document.getElementById('montoPago').value = '';
  document.getElementById('referenciaPago').value = '';
}

btnAgregarPago.addEventListener('click', async () => {
  modalPagoTitulo.textContent = 'Registrar Pago';
  resetFormPago();
  await cargarTasaBCV();
  modalPago.style.display = 'block';
});

spanClosePago.addEventListener('click', () => {
  modalPago.style.display = 'none';
});
window.addEventListener('click', (e) => {
  if (e.target === modalPago) modalPago.style.display = 'none';
});

formPago.addEventListener('submit', async (e) => {
  e.preventDefault();
  const pagoId = document.getElementById('pagoId').value;
  const fecha = document.getElementById('fechaPago').value;
  const monto_bs = parseFloat(document.getElementById('montoPago').value);
  const tasa_bcv = parseFloat(document.getElementById('tasaPago').value);
  const referencia = document.getElementById('referenciaPago').value;

  if (!fecha || isNaN(monto_bs) || monto_bs <= 0 || isNaN(tasa_bcv) || tasa_bcv <= 0 || !referencia) {
    alert('Todos los campos son obligatorios y los montos deben ser positivos');
    return;
  }

  try {
    const datos = {
      id: pagoId ? parseInt(pagoId) : null,
      propietario_id: parseInt(propietarioId),
      fecha_pago: fecha,
      monto_bs,
      tasa_bcv,
      referencia
    };

    if (pagoId) {
      await api.updatePagoPropietario(datos);
      alert('Pago actualizado correctamente');
    } else {
      await api.crearPagoPropietario(datos);
      alert('Pago registrado con éxito. Queda pendiente de verificación.');
    }
    modalPago.style.display = 'none';
    await cargarDatos();
  } catch (err) {
    alert('Error al guardar pago: ' + err.message);
  }
});

window.editarPago = async (pagoId) => {
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    const pago = pagos.find(p => p.id === pagoId);
    if (!pago) throw new Error('Pago no encontrado');
    if (pago.estado === 'verificado') {
      alert('No se puede editar un pago ya verificado');
      return;
    }

    modalPagoTitulo.textContent = 'Editar Pago';
    document.getElementById('pagoId').value = pago.id;
    document.getElementById('fechaPago').value = pago.fecha_pago || '';
    document.getElementById('montoPago').value = pago.monto_bs;
    document.getElementById('tasaPago').value = pago.tasa_bcv;
    document.getElementById('referenciaPago').value = pago.referencia || '';

    const tasaDiv = document.getElementById('tasaActual');
    tasaDiv.innerHTML = `Tasa registrada: ${pago.tasa_bcv.toFixed(2)} Bs/USD (puedes modificarla si es necesario)`;
    modalPago.style.display = 'block';
  } catch (err) {
    alert('Error al cargar pago: ' + err.message);
  }
};

window.eliminarPago = async (pagoId) => {
  if (!confirm('¿Estás seguro de eliminar este pago? Esta acción no se puede deshacer.')) return;
  try {
    const pagos = await api.getPagosByPropietario(parseInt(propietarioId));
    const pago = pagos.find(p => p.id === pagoId);
    if (pago && pago.estado === 'verificado') {
      alert('No se puede eliminar un pago ya verificado');
      return;
    }
    await api.deletePagoPropietario(pagoId);
    alert('Pago eliminado');
    await cargarDatos();
  } catch (err) {
    alert('Error al eliminar: ' + err.message);
  }
};

// Botón recargar
const btnRecargar = document.getElementById('btnRecargar');
if (btnRecargar) {
  btnRecargar.addEventListener('click', () => {
    cargarDatos();
    alert('Datos recargados');
  });
}

// ----- Cambiar contraseña -----
const modalPassword = document.getElementById('modalPassword');
const btnCambiar = document.getElementById('btnCambiarPassword');
const spanClosePass = document.querySelector('#modalPassword .close');
const formPassword = document.getElementById('formPassword');

btnCambiar.addEventListener('click', () => modalPassword.style.display = 'block');
spanClosePass.addEventListener('click', () => modalPassword.style.display = 'none');
window.addEventListener('click', (e) => {
  if (e.target === modalPassword) modalPassword.style.display = 'none';
});

formPassword.addEventListener('submit', async (e) => {
  e.preventDefault();
  const nueva = document.getElementById('nuevaPassword').value;
  const confirm = document.getElementById('confirmPassword').value;
  if (nueva !== confirm) {
    alert('Las contraseñas no coinciden');
    return;
  }
  try {
    await api.cambiarPassword(parseInt(usuarioId), nueva);
    alert('Contraseña cambiada con éxito');
    modalPassword.style.display = 'none';
    document.getElementById('nuevaPassword').value = '';
    document.getElementById('confirmPassword').value = '';
  } catch (err) {
    alert('Error al cambiar contraseña: ' + err.message);
  }
});

// Logout
document.getElementById('logout').addEventListener('click', () => {
  localStorage.removeItem('token');
  window.location.href = '/login.html';
});

// ---------- Verificar autenticación y cargar datos ----------
document.addEventListener('DOMContentLoaded', async () => {
  if (!localStorage.getItem('token')) {
    window.location.href = '/login.html';
    return;
  }
  try {
    // Verificar que el token es válido (petición de prueba)
    await api.getPropietarioById(parseInt(propietarioId));
    cargarDatos();
  } catch (err) {
    // Si falla, ya se redirige dentro de fetchAPI
  }
});