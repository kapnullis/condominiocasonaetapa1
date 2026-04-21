// public/Fmaster/ui.js
// Funciones de UI compartidas, especialmente para el modal de recibo y recálculo dinámico

import { api } from './api.js';
import { $, $$ } from './utils.js';
import { currentTasaBCV } from './tasa.js';
import { grupos } from './deudas.js';

/**
 * Recalcula la tabla de resumen por propietario dentro del modal de recibo
 */
export async function recalcularTodo() {
  const totalSpan = $('#totalGastosUSD');
  if (!totalSpan) return;

  const totalGastosGeneralesUSD = parseFloat(totalSpan.innerText) || 0;
  if (totalGastosGeneralesUSD === 0) {
    const tbody = $('#tablaResumenPropietarios tbody');
    if (tbody) tbody.innerHTML = '';
    return;
  }

  // Obtener alícuotas de los grupos
  const alicuotasGrupo = [];
  const rowsGrupo = $$('#gruposAlicuotasContainer .grupo-alicuota-row');
  for (const row of rowsGrupo) {
    const select = row.querySelector('select');
    const input = row.querySelector('input[type="number"]');
    if (select && select.value && input && input.value) {
      alicuotasGrupo.push({
        grupoId: parseInt(select.value),
        porcentaje: parseFloat(input.value)
      });
    }
  }

  // Obtener gastos específicos
  const gastosEsp = [];
  const rowsEsp = $$('#gastosEspecificosContainer .gasto-especifico-row');
  for (const row of rowsEsp) {
    const tipoSelect = row.querySelector('select:first-child');
    const destinoSelect = row.querySelector('select:nth-child(2)');
    const descInput = row.querySelector('input[type="text"]');
    const montoInput = row.querySelector('.gasto-especifico-monto-ves');

    if (!destinoSelect || !montoInput) continue;

    const tipo = tipoSelect?.value;
    const destinoValue = destinoSelect.value;
    const montoVES = parseFloat(montoInput.value);

    if (destinoValue && !isNaN(montoVES) && montoVES > 0 && currentTasaBCV > 0) {
      const [tipoDest, idStr] = destinoValue.split('_');
      const id = parseInt(idStr);
      const montoUSD = montoVES / currentTasaBCV;
      gastosEsp.push({
        tipo: tipoDest,
        id: id,
        monto: montoUSD,
        descripcion: descInput?.value || 'Gasto específico'
      });
    }
  }

  // Obtener todos los propietarios
  const todosPropietarios = await api.getPropietarios();
  const propietariosPorGrupo = {};
  todosPropietarios.forEach(p => {
    if (!propietariosPorGrupo[p.grupo_id]) propietariosPorGrupo[p.grupo_id] = [];
    propietariosPorGrupo[p.grupo_id].push(p);
  });

  // Mapa para acumular montos base y adicionales
  const montoPorPropietario = new Map(); // propId -> { base: number, adicional: number }

  // Distribuir gastos generales según alícuotas
  for (const ag of alicuotasGrupo) {
    const montoGrupo = totalGastosGeneralesUSD * (ag.porcentaje / 100);
    const propietariosDelGrupo = propietariosPorGrupo[ag.grupoId] || [];
    if (propietariosDelGrupo.length === 0) continue;

    const montoPorProp = montoGrupo / propietariosDelGrupo.length;
    propietariosDelGrupo.forEach(p => {
      if (!montoPorPropietario.has(p.id)) {
        montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
      }
      montoPorPropietario.get(p.id).base += montoPorProp;
    });
  }

  // Distribuir gastos específicos
  for (const ge of gastosEsp) {
    if (ge.tipo === 'grupo') {
      const propietariosDelGrupo = propietariosPorGrupo[ge.id] || [];
      if (propietariosDelGrupo.length === 0) continue;
      const montoAdicionalPorProp = ge.monto / propietariosDelGrupo.length;
      propietariosDelGrupo.forEach(p => {
        if (!montoPorPropietario.has(p.id)) {
          montoPorPropietario.set(p.id, { base: 0, adicional: 0 });
        }
        montoPorPropietario.get(p.id).adicional += montoAdicionalPorProp;
      });
    } else if (ge.tipo === 'prop') {
      if (!montoPorPropietario.has(ge.id)) {
        montoPorPropietario.set(ge.id, { base: 0, adicional: 0 });
      }
      montoPorPropietario.get(ge.id).adicional += ge.monto;
    }
  }

  // Renderizar tabla de resumen
  const tbody = $('#tablaResumenPropietarios tbody');
  if (!tbody) return;
  tbody.innerHTML = '';

  for (const [propId, montos] of montoPorPropietario.entries()) {
    const prop = todosPropietarios.find(p => p.id === propId);
    if (!prop) continue;

    const grupoNombre = grupos.find(g => g.id === prop.grupo_id)?.nombre || 'Sin grupo';
    const total = montos.base + montos.adicional;

    const row = tbody.insertRow();
    row.insertCell(0).innerText = prop.nombre;
    row.insertCell(1).innerText = prop.apartamento;
    row.insertCell(2).innerText = grupoNombre;
    row.insertCell(3).innerText = montos.base.toFixed(2);
    row.insertCell(4).innerText = montos.adicional.toFixed(2);
    row.insertCell(5).innerText = total.toFixed(2);
  }
}

/**
 * Actualiza los valores USD en las filas de gastos específicos cuando cambia la tasa
 */
export function actualizarUSDEnGastosEspecificos() {
  if (!currentTasaBCV || currentTasaBCV <= 0) return;

  const rows = $$('#gastosEspecificosContainer .gasto-especifico-row');
  rows.forEach(row => {
    const montoVESInput = row.querySelector('.gasto-especifico-monto-ves');
    const usdSpan = row.querySelector('.gasto-especifico-usd');
    if (montoVESInput && usdSpan) {
      const montoVES = parseFloat(montoVESInput.value);
      if (!isNaN(montoVES) && montoVES > 0) {
        const usd = montoVES / currentTasaBCV;
        usdSpan.innerText = usd.toFixed(2) + ' USD';
      } else {
        usdSpan.innerText = '0.00 USD';
      }
    }
  });
}