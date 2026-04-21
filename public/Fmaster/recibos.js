// public/Fmaster/recibos.js
// Módulo de gestión de recibos: creación, visualización y cálculos asociados

import { api } from './api.js';
import { $, $$, formatearFecha, escapeHtml, validarPeriodo, redondearUSD } from './utils.js';
import { currentTasaBCV, currentFechaTasa, obtenerTasaBCV, setTasaManual, onTasaChange } from './tasa.js';
import { cargarDeudas, actualizarSaldoPropietario, propiedadSeleccionada, grupos as deudasGrupos } from './deudas.js';
import { cargarPagosPendientes } from './pagos.js';
import { recalcularTodo, actualizarUSDEnGastosEspecificos } from './ui.js';

// Estado local
let grupos = [];
let isSubmitting = false;
let modalVerRecibo = null;

// Callbacks que serán inyectados desde core
let recalcularTodoCallback = recalcularTodo;
let actualizarUSDEnGastosEspecificosCallback = actualizarUSDEnGastosEspecificos;

export function setRecalcularCallbacks(recalcular, actualizarUSD) {
  recalcularTodoCallback = recalcular;
  actualizarUSDEnGastosEspecificosCallback = actualizarUSD;
}

// ---------- Funciones de UI para el modal de recibo ----------
export function agregarFilaGasto(descripcion = '', montoVES = 0) {
  const container = $('#gastosContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'gasto-row';
  row.innerHTML = `
    <input type="text" class="gasto-desc" placeholder="Descripción" value="${escapeHtml(descripcion)}">
    <input type="number" class="gasto-monto" placeholder="Monto VES" step="any" value="${montoVES}">
    <span class="gasto-usd">0.00 USD</span>
    <button type="button" class="btn-eliminar-gasto">✖</button>
  `;

  const eliminarBtn = row.querySelector('.btn-eliminar-gasto');
  eliminarBtn.addEventListener('click', () => {
    row.remove();
    calcularTotalGastos();
    if (recalcularTodoCallback) recalcularTodoCallback();
  });

  const montoInput = row.querySelector('.gasto-monto');
  montoInput.addEventListener('input', () => {
    calcularTotalGastos();
    if (recalcularTodoCallback) recalcularTodoCallback();
  });

  container.appendChild(row);
  calcularTotalGastos();
}

export function calcularTotalGastos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) {
    const totalSpan = $('#totalGastosUSD');
    if (totalSpan) totalSpan.innerText = '0.00';
    return 0;
  }

  let totalUSD = 0;
  const filas = $$('#gastosContainer .gasto-row');
  filas.forEach(fila => {
    const montoInput = fila.querySelector('.gasto-monto');
    const usdSpan = fila.querySelector('.gasto-usd');
    if (montoInput && usdSpan) {
      const montoVES = parseFloat(montoInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        const usd = montoVES / currentTasaBCV;
        totalUSD += usd;
        usdSpan.innerText = usd.toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });

  const totalSpan = $('#totalGastosUSD');
  if (totalSpan) totalSpan.innerText = totalUSD.toFixed(2);
  return totalUSD;
}

export function agregarGrupoAlicuota(grupoId = '', porcentaje = '') {
  const container = $('#gruposAlicuotasContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'grupo-alicuota-row';

  const select = document.createElement('select');
  select.innerHTML = '<option value="">Seleccione grupo</option>' +
    grupos.map(g => `<option value="${g.id}" ${grupoId == g.id ? 'selected' : ''}>${g.nombre}</option>`).join('');
  select.addEventListener('change', () => {
    if (recalcularTodoCallback) recalcularTodoCallback();
    validarSumaAlicuotas();
  });

  const inputPorc = document.createElement('input');
  inputPorc.type = 'number';
  inputPorc.step = '0.001';
  inputPorc.placeholder = '%';
  inputPorc.value = porcentaje;
  inputPorc.addEventListener('input', () => {
    if (recalcularTodoCallback) recalcularTodoCallback();
    validarSumaAlicuotas();
  });

  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖';
  btnEliminar.style.backgroundColor = '#dc3545';
  btnEliminar.addEventListener('click', () => {
    row.remove();
    if (recalcularTodoCallback) recalcularTodoCallback();
    validarSumaAlicuotas();
  });

  row.appendChild(select);
  row.appendChild(inputPorc);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

export function validarSumaAlicuotas() {
  let suma = 0;
  const rows = $$('#gruposAlicuotasContainer .grupo-alicuota-row');
  rows.forEach(row => {
    const input = row.querySelector('input[type="number"]');
    if (input && input.value) suma += parseFloat(input.value) || 0;
  });

  const msgDiv = $('#sumaAlicuotasMsg');
  if (!msgDiv) return false;

  if (Math.abs(suma - 100) > 0.001) {
    msgDiv.innerHTML = `⚠️ La suma de alícuotas es ${suma.toFixed(3)}%. Debe ser 100% para continuar.`;
    msgDiv.style.color = 'orange';
    return false;
  } else {
    msgDiv.innerHTML = `✅ Suma correcta: 100%`;
    msgDiv.style.color = 'green';
    return true;
  }
}

export function agregarGastoEspecifico() {
  const container = $('#gastosEspecificosContainer');
  if (!container) return;

  const row = document.createElement('div');
  row.className = 'gasto-especifico-row';
  row.style.cssText = 'display:flex; gap:10px; align-items:center; margin-bottom:8px; background:#e9ecef; padding:8px; border-radius:4px; flex-wrap:wrap;';

  const selectTipo = document.createElement('select');
  selectTipo.innerHTML = `
    <option value="grupo">Afecta a un grupo (reparto equitativo)</option>
    <option value="propietario">Afecta a un propietario específico</option>
  `;
  selectTipo.style.flex = '1';

  const selectDestino = document.createElement('select');
  selectDestino.innerHTML = '<option value="">Seleccione...</option>';
  selectDestino.style.flex = '1';

  const inputDescripcion = document.createElement('input');
  inputDescripcion.type = 'text';
  inputDescripcion.placeholder = 'Descripción del gasto';
  inputDescripcion.style.flex = '1.5';

  const inputMontoVES = document.createElement('input');
  inputMontoVES.type = 'number';
  inputMontoVES.step = 'any';
  inputMontoVES.placeholder = 'Monto VES';
  inputMontoVES.className = 'gasto-especifico-monto-ves';
  inputMontoVES.style.flex = '1';

  const usdSpan = document.createElement('span');
  usdSpan.className = 'gasto-especifico-usd';
  usdSpan.innerText = '0.00 USD';
  usdSpan.style.flex = '0.8';

  const btnEliminar = document.createElement('button');
  btnEliminar.textContent = '✖';
  btnEliminar.style.cssText = 'background:#dc3545; padding:5px 10px;';

  async function cargarDestinos() {
    if (selectTipo.value === 'grupo') {
      const gruposList = await api.getGrupos();
      selectDestino.innerHTML = '<option value="">Seleccione grupo</option>' +
        gruposList.map(g => `<option value="grupo_${g.id}">${g.nombre}</option>`).join('');
    } else {
      const props = await api.getPropietarios();
      selectDestino.innerHTML = '<option value="">Seleccione propietario</option>' +
        props.map(p => `<option value="prop_${p.id}">${p.nombre} (${p.apartamento})</option>`).join('');
    }
  }

  function actualizarUSD() {
    if (!currentTasaBCV || currentTasaBCV <= 0) return;
    const montoVES = parseFloat(inputMontoVES.value);
    if (!isNaN(montoVES) && montoVES > 0) {
      const usd = montoVES / currentTasaBCV;
      usdSpan.innerText = usd.toFixed(2) + ' USD';
    } else {
      usdSpan.innerText = '0.00 USD';
    }
  }

  selectTipo.addEventListener('change', cargarDestinos);
  cargarDestinos();
  inputMontoVES.addEventListener('input', () => {
    actualizarUSD();
    if (recalcularTodoCallback) recalcularTodoCallback();
  });
  inputDescripcion.addEventListener('input', () => { if (recalcularTodoCallback) recalcularTodoCallback(); });
  selectDestino.addEventListener('change', () => { if (recalcularTodoCallback) recalcularTodoCallback(); });
  btnEliminar.addEventListener('click', () => { row.remove(); if (recalcularTodoCallback) recalcularTodoCallback(); });

  row.appendChild(selectTipo);
  row.appendChild(selectDestino);
  row.appendChild(inputDescripcion);
  row.appendChild(inputMontoVES);
  row.appendChild(usdSpan);
  row.appendChild(btnEliminar);
  container.appendChild(row);
}

// ---------- Envío del formulario de recibo ----------
async function handleSubmitRecibo(e) {
  e.preventDefault();
  e.stopPropagation();

  if (isSubmitting) {
    alert('Ya se está procesando el recibo. Por favor espera.');
    return;
  }

  const submitBtn = $('#formRecibo button[type="submit"]');
  const originalText = submitBtn?.textContent || 'Crear Recibo y Deudas';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.textContent = '⏳ Procesando...';
  }
  isSubmitting = true;

  try {
    const periodo = $('#periodoRecibo')?.value;
    if (!validarPeriodo(periodo)) {
      alert('Período inválido (MM/AAAA)');
      return;
    }

    const tasaInput = $('#tasaBCV');
    if (tasaInput) {
      const tasaManual = parseFloat(tasaInput.value);
      if (isNaN(tasaManual) || tasaManual <= 0) {
        alert('Ingrese una tasa BCV válida (positiva)');
        return;
      }
      setTasaManual(tasaManual);
    } else if (!currentTasaBCV || currentTasaBCV <= 0) {
      alert('Obtenga o ingrese la tasa BCV primero');
      return;
    }

    // Recolectar gastos generales
    const gastos = [];
    const filasGastos = $$('#gastosContainer .gasto-row');
    for (let f of filasGastos) {
      const desc = f.querySelector('.gasto-desc')?.value;
      const montoVES = parseFloat(f.querySelector('.gasto-monto')?.value);
      if (desc && !isNaN(montoVES) && montoVES > 0) {
        gastos.push({
          descripcion: desc,
          monto_ves: montoVES,
          monto_usd: redondearUSD(montoVES / currentTasaBCV)
        });
      }
    }
    if (gastos.length === 0) {
      alert('Agregue al menos un gasto general');
      return;
    }
    const totalGastosGeneralesUSD = gastos.reduce((s, g) => s + g.monto_usd, 0);

    // Alícuotas
    const alicuotasGrupo = [];
    const rowsGrupo = $$('#gruposAlicuotasContainer .grupo-alicuota-row');
    for (const row of rowsGrupo) {
      const select = row.querySelector('select');
      const input = row.querySelector('input[type="number"]');
      if (select?.value && input?.value) {
        alicuotasGrupo.push({ grupoId: parseInt(select.value), porcentaje: parseFloat(input.value) });
      }
    }
    if (!validarSumaAlicuotas()) {
      alert('La suma de alícuotas debe ser 100%');
      return;
    }

    // Gastos específicos
    const gastosEspecificos = [];
    const rowsEsp = $$('#gastosEspecificosContainer .gasto-especifico-row');
    const gruposEnAlicuota = new Set(alicuotasGrupo.map(ag => ag.grupoId));
    for (const row of rowsEsp) {
      const tipo = row.querySelector('select:first-child')?.value;
      const destinoSelect = row.querySelector('select:nth-child(2)');
      const descripcion = row.querySelector('input[type="text"]')?.value;
      const montoVES = parseFloat(row.querySelector('.gasto-especifico-monto-ves')?.value);
      if (destinoSelect?.value && !isNaN(montoVES) && montoVES > 0) {
        const [tipoDest, id] = destinoSelect.value.split('_');
        if (tipoDest === 'grupo') {
          const grupoId = parseInt(id);
          if (!gruposEnAlicuota.has(grupoId)) {
            alert(`Error: El grupo seleccionado no está en la lista de alícuotas.`);
            return;
          }
        }
        const montoUSD = redondearUSD(montoVES / currentTasaBCV);
        gastosEspecificos.push({
          tipo: tipoDest,
          id: parseInt(id),
          monto: montoUSD,
          descripcion: descripcion || 'Gasto específico'
        });
      }
    }
    const totalGastosEspecificosUSD = gastosEspecificos.reduce((sum, ge) => sum + ge.monto, 0);
    const totalGastosUSD = totalGastosGeneralesUSD + totalGastosEspecificosUSD;

    // Cálculo de montos por propietario
    const todosPropietarios = await api.getPropietarios();
    const propietariosPorGrupo = {};
    todosPropietarios.forEach(p => {
      if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
      propietariosPorGrupo[p.grupo_id].push(p);
    });

    const montoPorPropietario = new Map();
    for (const ag of alicuotasGrupo) {
      const montoGrupo = totalGastosGeneralesUSD * (ag.porcentaje / 100);
      const propietariosDelGrupo = propietariosPorGrupo[ag.grupoId] || [];
      if (propietariosDelGrupo.length === 0) continue;
      const montoPorProp = montoGrupo / propietariosDelGrupo.length;
      propietariosDelGrupo.forEach(p => {
        montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoPorProp);
      });
    }
    for (const ge of gastosEspecificos) {
      if (ge.tipo === 'grupo') {
        const propietariosDelGrupo = propietariosPorGrupo[ge.id] || [];
        if (propietariosDelGrupo.length === 0) continue;
        const montoAdicionalPorProp = ge.monto / propietariosDelGrupo.length;
        propietariosDelGrupo.forEach(p => {
          montoPorPropietario.set(p.id, (montoPorPropietario.get(p.id) || 0) + montoAdicionalPorProp);
        });
      } else if (ge.tipo === 'prop') {
        montoPorPropietario.set(ge.id, (montoPorPropietario.get(ge.id) || 0) + ge.monto);
      }
    }

    // Crear recibo
    const reciboData = {
      periodo,
      monto_usd: totalGastosUSD,
      gastos_generales: JSON.stringify(gastos),
      alicuotas_grupo: JSON.stringify(alicuotasGrupo),
      gastos_especificos: JSON.stringify(gastosEspecificos),
      tasa_bcv: currentTasaBCV,
      fecha_tasa: currentFechaTasa || new Date().toISOString()
    };

    const reciboCreado = await api.addRecibo(reciboData);
    const reciboId = reciboCreado.id;

    let deudasCreadas = 0;
    for (let [propId, monto] of montoPorPropietario.entries()) {
      if (monto <= 0) continue;
      const montoRedondeado = redondearUSD(monto);
      await api.addDeuda({
        propietario_id: propId,
        periodo,
        monto_usd: montoRedondeado,
        fecha_vencimiento: null,
        recibo_id: reciboId,
        porcentaje_alicuota: (montoRedondeado / totalGastosUSD) * 100
      });
      deudasCreadas++;
    }

    alert(`✅ Recibo creado. Se generaron ${deudasCreadas} deudas.`);
    const modal = $('#modalRecibo');
    if (modal) modal.style.display = 'none';

    await cargarRecibos();
    if (propiedadSeleccionada) {
      await cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
    await cargarPagosPendientes();
  } catch (err) {
    console.error('Error al crear recibo:', err);
    alert('Error al crear el recibo: ' + err.message);
  } finally {
    isSubmitting = false;
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }
  }
}

// ---------- Visualización de recibos existentes ----------
export async function cargarRecibos() {
  const tbody = $('#tablaRecibos tbody');
  if (!tbody) return;
  tbody.innerHTML = '<td colspan="4">Cargando...</td>';
  try {
    const recibos = await api.getRecibos();
    tbody.innerHTML = '';
    for (const r of recibos) {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${r.periodo}</td>
        <td>$${r.monto_usd.toFixed(2)}</td>
        <td>${r.grupo_id ? (grupos.find(g => g.id === r.grupo_id)?.nombre || 'Desconocido') : 'Todos'}</td>
        <td><button class="btn-ver-recibo" data-id="${r.id}" style="background-color:#17a2b8;">Ver Recibo</button></td>
      `;
      tbody.appendChild(tr);
    }

    $$('.btn-ver-recibo').forEach(btn => {
      btn.addEventListener('click', () => verRecibo(btn.dataset.id));
    });
  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<td colspan="4">Error: ${err.message}</td>`;
  }
}

function crearModalVerRecibo() {
  if (modalVerRecibo) return;
  modalVerRecibo = document.createElement('div');
  modalVerRecibo.id = 'modalVerRecibo';
  modalVerRecibo.className = 'modal';
  modalVerRecibo.innerHTML = `
    <div class="modal-content" style="width: 700px; max-width: 95%;">
      <span class="close">&times;</span>
      <h3>Detalles del Recibo</h3>
      <div id="verReciboContent" style="max-height: 70vh; overflow-y: auto;"></div>
      <div style="margin-top: 15px; text-align: center;">
        <button id="btnImprimirRecibo" style="background-color: #28a745; color: white; border: none; padding: 8px 16px; border-radius: 4px; cursor: pointer;">🖨️ Imprimir / Guardar PDF</button>
      </div>
    </div>
  `;
  document.body.appendChild(modalVerRecibo);

  const closeSpan = modalVerRecibo.querySelector('.close');
  closeSpan.addEventListener('click', () => modalVerRecibo.style.display = 'none');
  window.addEventListener('click', (e) => {
    if (e.target === modalVerRecibo) modalVerRecibo.style.display = 'none';
  });

  const btnImprimir = $('#btnImprimirRecibo');
  if (btnImprimir) {
    btnImprimir.addEventListener('click', () => {
      const contenido = $('#verReciboContent').innerHTML;
      const ventana = window.open('', '_blank', 'width=800,height=600');
      ventana.document.write(`
        <!DOCTYPE html>
        <html><head><title>Recibo</title>
        <style>body{font-family:Arial;padding:20px} table{width:100%;border-collapse:collapse} th,td{border:1px solid #ddd;padding:8px} th{background:#f2f2f2}</style>
        </head><body>${contenido}</body></html>
      `);
      ventana.document.close();
      ventana.print();
    });
  }
}

export async function verRecibo(reciboId) {
  try {
    crearModalVerRecibo();
    const recibo = await api.getReciboById(reciboId);
    if (!recibo) throw new Error('No se pudo obtener el recibo');

    let totalGastosGenerales = 0;
    if (recibo.gastos_generales?.length) {
      totalGastosGenerales = recibo.gastos_generales.reduce((s, g) => s + (g.monto_usd || 0), 0);
    }

    let html = `<p><strong>Período:</strong> ${recibo.periodo}</p>`;
    html += `<p><strong>Total gastos generales:</strong> $${totalGastosGenerales.toFixed(2)}</p>`;
    html += `<h4>Gastos generales:</h4>`;
    if (recibo.gastos_generales?.length) {
      html += `<table><tr><th>Descripción</th><th>Monto (Bs)</th><th>Monto (USD)</th></tr>`;
      recibo.gastos_generales.forEach(g => html += `<tr><td>${g.descripcion}</td><td>${g.monto_ves.toFixed(2)}</td><td>$${g.monto_usd.toFixed(2)}</td></tr>`);
      html += `</table>`;
    } else html += '<p>No hay gastos.</p>';

    if (recibo.gastos_especificos?.length) {
      html += `<h4>Gastos específicos:</h4><table><tr><th>Descripción</th><th>Afecta a</th><th>Monto (USD)</th></tr>`;
      recibo.gastos_especificos.forEach(ge => {
        let destino = ge.tipo === 'grupo' ? `Grupo ${ge.id}` : `Propietario ${ge.id}`;
        html += `<tr><td>${ge.descripcion}</td><td>${destino}</td><td>$${ge.monto.toFixed(2)}</td></tr>`;
      });
      html += `</table>`;
    }

    $('#verReciboContent').innerHTML = html;
    modalVerRecibo.style.display = 'block';
  } catch (err) {
    console.error(err);
    alert('Error al cargar detalle del recibo: ' + err.message);
  }
}

// ---------- Inicialización del módulo ----------
export async function initRecibos(gruposData) {
  grupos = gruposData;

  const btnAgregarRecibo = $('#btnAgregarRecibo');
  if (btnAgregarRecibo) {
    btnAgregarRecibo.addEventListener('click', async () => {
      ['periodoRecibo', 'gastosContainer', 'gruposAlicuotasContainer', 'gastosEspecificosContainer'].forEach(id => {
        const el = $(`#${id}`);
        if (el) el.innerHTML = '';
        else if (id === 'periodoRecibo') $(`#${id}`).value = '';
      });
      agregarFilaGasto();
      if (!currentTasaBCV) await obtenerTasaBCV();
      else {
        $('#tasaBCV').value = currentTasaBCV;
        if (currentFechaTasa) $('#fechaTasa').innerText = `Actualizada: ${new Date(currentFechaTasa).toLocaleDateString('es-ES')}`;
      }
      $('#modalRecibo').style.display = 'block';
    });
  }

  $('#btnActualizarTasa')?.addEventListener('click', obtenerTasaBCV);
  $('#btnAgregarGasto')?.addEventListener('click', () => agregarFilaGasto());
  $('#btnAgregarGrupoAlicuota')?.addEventListener('click', () => agregarGrupoAlicuota());
  $('#btnAgregarGastoEspecifico')?.addEventListener('click', () => agregarGastoEspecifico());
  $('#formRecibo')?.addEventListener('submit', handleSubmitRecibo);

  const modalRecibo = $('#modalRecibo');
  const closeBtn = modalRecibo?.querySelector('.close');
  if (closeBtn) closeBtn.addEventListener('click', () => modalRecibo.style.display = 'none');
  window.addEventListener('click', (e) => { if (e.target === modalRecibo) modalRecibo.style.display = 'none'; });

  document.addEventListener('change', (e) => {
    if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer'))
      if (recalcularTodoCallback) recalcularTodoCallback();
  });
  document.addEventListener('input', (e) => {
    if (e.target.closest('#gruposAlicuotasContainer, #gastosEspecificosContainer, #gastosContainer'))
      if (recalcularTodoCallback) recalcularTodoCallback();
    if (e.target.id === 'tasaBCV') {
      setTasaManual(e.target.value);
      calcularTotalGastos();
      if (actualizarUSDEnGastosEspecificosCallback) actualizarUSDEnGastosEspecificosCallback();
      if (recalcularTodoCallback) recalcularTodoCallback();
    }
  });

  await cargarRecibos();
}