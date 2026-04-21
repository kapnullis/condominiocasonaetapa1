// public/Fmaster/deudas.js
// Módulo de gestión de deudas: visualización por propiedad, selección de grupos/propietarios y modal de nueva deuda

import { api } from './api.js';
import { $, $$, formatearFecha } from './utils.js';
import { cargarPagosPendientes } from './pagos.js';

// Estado compartido del módulo
export let grupos = [];
export let propietarios = [];
export let grupoSeleccionado = null;
export let propiedadSeleccionada = null;
export let deudasGlobal = [];

// ---------- Funciones de UI para la sección de deudas ----------

/**
 * Carga los grupos en el contenedor de tabs y muestra el grupo actual o "Sin grupo"
 */
export async function cargarGruposParaDeudas() {
  const container = $('#gruposContainer');
  if (!container) return;
  
  try {
    const gruposList = await api.getGrupos();
    grupos = gruposList;
    container.innerHTML = '';

    // Tab "Sin grupo"
    const sinGrupoTab = document.createElement('div');
    sinGrupoTab.className = 'group-tab';
    sinGrupoTab.style.backgroundColor = (grupoSeleccionado === null) ? '#007bff' : '#6c757d';
    const sinGrupoBtn = document.createElement('button');
    sinGrupoBtn.textContent = 'Sin grupo';
    sinGrupoBtn.style.backgroundColor = 'transparent';
    sinGrupoBtn.addEventListener('click', () => seleccionarGrupoDeuda(null));
    sinGrupoTab.appendChild(sinGrupoBtn);
    container.appendChild(sinGrupoTab);

    for (const g of gruposList) {
      const tabDiv = document.createElement('div');
      tabDiv.className = 'group-tab';
      tabDiv.style.backgroundColor = (grupoSeleccionado === g.id) ? '#007bff' : '#6c757d';
      const btn = document.createElement('button');
      btn.textContent = g.nombre;
      btn.style.backgroundColor = 'transparent';
      btn.addEventListener('click', () => seleccionarGrupoDeuda(g.id));
      tabDiv.appendChild(btn);
      container.appendChild(tabDiv);
    }

    if (!grupoSeleccionado) {
      seleccionarGrupoDeuda(null);
    }
  } catch (err) {
    console.error('Error cargando grupos para deudas:', err);
  }
}

/**
 * Selecciona un grupo y actualiza las propiedades mostradas
 */
export async function seleccionarGrupoDeuda(grupoId) {
  grupoSeleccionado = grupoId;
  
  // Actualizar estilos de tabs
  const tabs = $$('#gruposContainer .group-tab');
  const gruposList = await api.getGrupos();
  tabs.forEach(tab => {
    const btn = tab.querySelector('button');
    const isSinGrupo = btn.textContent === 'Sin grupo';
    if (isSinGrupo && grupoId === null) {
      tab.style.backgroundColor = '#007bff';
    } else if (!isSinGrupo) {
      const g = gruposList.find(g => g.nombre === btn.textContent);
      if (g && g.id === grupoId) {
        tab.style.backgroundColor = '#007bff';
      } else {
        tab.style.backgroundColor = '#6c757d';
      }
    } else {
      tab.style.backgroundColor = '#6c757d';
    }
  });

  await cargarPropiedadesDeuda(grupoId);
}

/**
 * Muestra los botones de propiedades (apartamentos) del grupo seleccionado
 */
export async function cargarPropiedadesDeuda(grupoId) {
  const container = $('#propiedadesContainer');
  if (!container) return;
  container.innerHTML = '';

  try {
    const props = await api.getPropietarios();
    propietarios = props;

    let propsGrupo;
    if (grupoId === null) {
      propsGrupo = props.filter(p => p.grupo_id === null);
    } else {
      propsGrupo = props.filter(p => p.grupo_id === grupoId);
    }

    if (propsGrupo.length === 0) {
      container.innerHTML = '<p>No hay propiedades en este grupo.</p>';
      $('#deudasTableContainer').style.display = 'none';
      return;
    }

    // Crear filas de hasta 4 botones
    for (let i = 0; i < propsGrupo.length; i += 4) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex; gap:5px; margin-bottom:5px; flex-wrap:wrap;';
      for (let j = i; j < Math.min(i + 4, propsGrupo.length); j++) {
        const prop = propsGrupo[j];
        const btn = document.createElement('button');
        btn.textContent = prop.apartamento;
        btn.style.cssText = 'background:#6c757d; padding:5px 10px; cursor:pointer;';
        btn.addEventListener('click', () => seleccionarPropiedadDeuda(prop.id));
        row.appendChild(btn);
      }
      container.appendChild(row);
    }

    // Si hay una propiedad seleccionada que pertenece al grupo, mantenerla resaltada
    if (propiedadSeleccionada && propsGrupo.some(p => p.id === propiedadSeleccionada)) {
      const selectedProp = propsGrupo.find(p => p.id === propiedadSeleccionada);
      $$('#propiedadesContainer button').forEach(btn => {
        if (btn.textContent === selectedProp.apartamento) btn.style.backgroundColor = '#007bff';
      });
    } else if (propsGrupo.length > 0) {
      // Seleccionar la primera por defecto
      seleccionarPropiedadDeuda(propsGrupo[0].id);
    }
  } catch (err) {
    console.error('Error cargando propiedades:', err);
  }
}

/**
 * Calcula y muestra el saldo neto de la propiedad (saldo a favor - deudas pendientes)
 */
export async function actualizarSaldoPropietario(propietarioId) {
  try {
    const prop = await api.getPropietarioById(propietarioId);
    if (!prop) return;

    const deudas = await api.getDeudasByPropietario(propietarioId);
    const totalDeudas = deudas.reduce((sum, d) => sum + (d.pagado ? 0 : d.monto_usd), 0);
    const saldoNeto = (prop.saldo_favor || 0) - totalDeudas;
    const esSaldoAFavor = saldoNeto >= 0;
    const saldoTexto = esSaldoAFavor
      ? `$${saldoNeto.toFixed(2)} (Saldo a favor)`
      : `-$${Math.abs(saldoNeto).toFixed(2)} (Deuda pendiente)`;

    const saldoElement = $('#saldoNetoPropiedad');
    if (saldoElement) {
      saldoElement.textContent = saldoTexto;
      saldoElement.style.color = esSaldoAFavor ? 'green' : 'red';
    }
  } catch (err) {
    console.error('Error al obtener saldo de la propiedad:', err);
  }
}

/**
 * Selecciona una propiedad específica y carga sus deudas
 */
export async function seleccionarPropiedadDeuda(propId) {
  propiedadSeleccionada = propId;

  const btns = $$('#propiedadesContainer button');
  const prop = propietarios.find(p => p.id === propId);
  if (!prop) return;

  btns.forEach(btn => {
    btn.style.backgroundColor = (btn.textContent === prop.apartamento) ? '#007bff' : '#6c757d';
  });

  await cargarDeudas(propId);
  await actualizarSaldoPropietario(propId);
  $('#deudasTableContainer').style.display = 'block';
}

/**
 * Carga la tabla de deudas de la propiedad seleccionada
 */
export async function cargarDeudas(propietarioId) {
  const tbody = $('#tablaDeudas tbody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="6">Cargando...</td></tr>';

  try {
    const deudas = await api.getDeudasByPropietario(propietarioId);
    deudasGlobal = deudas;
    tbody.innerHTML = '';

    if (deudas.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No hay deudas registradas para esta propiedad.</td></tr>';
      return;
    }

    for (const d of deudas) {
      const isPaid = d.pagado === 1;
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${d.periodo}</td>
        <td>$${d.monto_usd.toFixed(2)}</td>
        <td>${formatearFecha(d.fecha_vencimiento)}</td>
        <td class="${isPaid ? 'verificado' : 'pendiente'}">${isPaid ? 'Pagada' : 'Pendiente'}</td>
        <td>${formatearFecha(d.fecha_pago)}</td>
        <td>${d.referencia_pago || '—'}</td>
      `;
      tbody.appendChild(tr);
    }
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="6">Error: ${err.message}</td></tr>`;
  }
}

// ---------- Modal para agregar deuda manual ----------

export function initDeudasModal() {
  const modalDeuda = $('#modalDeuda');
  const btnAgregarDeuda = $('#btnAgregarDeuda');
  const spanCloseDeuda = modalDeuda?.querySelector('.close');
  const formDeuda = $('#formDeuda');
  const propietarioSelect = $('#propietarioSelect');

  if (!modalDeuda || !btnAgregarDeuda) return;

  btnAgregarDeuda.addEventListener('click', async () => {
    if (!propiedadSeleccionada) {
      alert('Primero selecciona una propiedad');
      return;
    }

    const props = await api.getPropietarios();
    propietarioSelect.innerHTML = '<option value="">Seleccionar</option>' +
      props.map(p => `<option value="${p.id}" ${p.id === propiedadSeleccionada ? 'selected' : ''}>${p.nombre} (${p.apartamento})</option>`).join('');

    $('#periodo').value = '';
    $('#montoUSD').value = '';
    $('#fechaVencimiento').value = '';
    $('#modalDeudaTitulo').textContent = 'Agregar Deuda';
    modalDeuda.style.display = 'block';
  });

  spanCloseDeuda?.addEventListener('click', () => {
    modalDeuda.style.display = 'none';
  });

  window.addEventListener('click', (e) => {
    if (e.target === modalDeuda) modalDeuda.style.display = 'none';
  });

  formDeuda?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const propietario_id = parseInt(propietarioSelect.value);
    const periodo = $('#periodo').value;
    const monto_usd = parseFloat($('#montoUSD').value);
    const fecha_vencimiento = $('#fechaVencimiento').value || null;

    if (!propietario_id || !periodo || isNaN(monto_usd) || monto_usd <= 0) {
      alert('Propietario, período y monto válido son obligatorios');
      return;
    }

    // Validar formato período
    if (!/^\d{2}\/\d{4}$/.test(periodo)) {
      alert('El período debe tener formato MM/AAAA');
      return;
    }

    try {
      await api.addDeuda({
        propietario_id,
        periodo,
        monto_usd,
        fecha_vencimiento
      });
      modalDeuda.style.display = 'none';

      // Si la deuda agregada corresponde a la propiedad seleccionada, refrescar
      if (propiedadSeleccionada === propietario_id) {
        await cargarDeudas(propiedadSeleccionada);
        await actualizarSaldoPropietario(propiedadSeleccionada);
      }
      // También refrescar pagos pendientes por si acaso
      await cargarPagosPendientes();
    } catch (err) {
      alert('Error al guardar deuda: ' + err.message);
    }
  });
}

// Escuchar evento de tasa actualizada para refrescar saldos si es necesario (opcional)
window.addEventListener('tasaActualizada', () => {
  if (propiedadSeleccionada) {
    actualizarSaldoPropietario(propiedadSeleccionada);
  }
});