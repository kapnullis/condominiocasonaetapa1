// public/Fmaster/pagos.js
// Módulo de pagos pendientes: visualización y verificación

import { api } from './api.js';
import { $, formatearFecha } from './utils.js';
import { cargarDeudas, actualizarSaldoPropietario, propiedadSeleccionada } from './deudas.js';

/**
 * Carga la tabla de pagos pendientes de verificación
 */
export async function cargarPagosPendientes() {
  const tbody = $('#tablaPagos tbody');
  if (!tbody) return;

  tbody.innerHTML = '<tr><td colspan="6">Cargando...</td></tr>';

  try {
    const pagos = await api.getPagosPendientes();
    tbody.innerHTML = '';

    if (pagos.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6">No hay pagos pendientes.</td></tr>';
      return;
    }

    pagos.forEach(p => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${p.propietario_nombre} (${p.apartamento})</td>
        <td>${formatearFecha(p.fecha_pago)}</td>
        <td>${p.monto_bs ? p.monto_bs.toFixed(2) : '—'}</td>
        <td>${p.referencia || '—'}</td>
        <td>${p.tasa_bcv ? p.tasa_bcv.toFixed(2) : '—'}</td>
        <td><button class="btn-verificar" data-id="${p.id}">Verificar</button></td>
      `;
      tbody.appendChild(tr);
    });

    // Adjuntar eventos a los botones Verificar
    document.querySelectorAll('.btn-verificar').forEach(btn => {
      btn.addEventListener('click', () => verificarPago(btn.dataset.id));
    });
  } catch (err) {
    console.error('Error cargando pagos pendientes:', err);
    tbody.innerHTML = `<tr><td colspan="6">Error: ${err.message}</td></tr>`;
  }
}

/**
 * Verifica un pago específico por su ID
 */
async function verificarPago(pagoId) {
  if (!confirm('¿Confirmar la verificación de este pago?')) return;

  try {
    await api.verificarPago(pagoId);
    alert('Pago verificado correctamente');

    // Refrescar la tabla de pagos pendientes
    await cargarPagosPendientes();

    // Si hay una propiedad seleccionada, refrescar sus deudas y saldo
    if (propiedadSeleccionada) {
      await cargarDeudas(propiedadSeleccionada);
      await actualizarSaldoPropietario(propiedadSeleccionada);
    }
  } catch (err) {
    alert('Error al verificar el pago: ' + err.message);
  }
}

// Exponer función global para compatibilidad con posibles llamadas inline
window.verificarPago = verificarPago;