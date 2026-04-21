// public/Fmaster/tasa.js
// Gestión de la tasa BCV (obtención, almacenamiento en memoria y eventos)

import { api } from './api.js';
import { $ } from './utils.js';

// Estado global del módulo
export let currentTasaBCV = null;
export let currentFechaTasa = null;

/**
 * Obtiene la tasa BCV desde la API y actualiza la UI.
 * Dispara un evento 'tasaActualizada' para que otros módulos reaccionen.
 * @returns {Promise<number|null>} Tasa obtenida o null si falla
 */
export async function obtenerTasaBCV() {
  try {
    const data = await api.getTasaBCV();
    currentTasaBCV = data.tasa;
    currentFechaTasa = data.fecha;

    // Actualizar input y etiqueta en la UI
    const tasaInput = $('#tasaBCV');
    if (tasaInput) {
      tasaInput.value = currentTasaBCV;
      const fechaSpan = $('#fechaTasa');
      if (fechaSpan) {
        const fecha = new Date(currentFechaTasa);
        fechaSpan.innerText = `Actualizada: ${fecha.toLocaleDateString('es-ES')}`;
      }
    }

    // Disparar evento personalizado para que otros módulos se enteren
    window.dispatchEvent(new CustomEvent('tasaActualizada', {
      detail: { tasa: currentTasaBCV, fecha: currentFechaTasa }
    }));

    console.log(`💰 Tasa BCV actualizada: ${currentTasaBCV} Bs/USD`);
    return currentTasaBCV;
  } catch (error) {
    console.error('Error obteniendo tasa BCV:', error);
    alert('No se pudo obtener la tasa BCV automáticamente. Puedes ingresarla manualmente.');
    return null;
  }
}

/**
 * Establece manualmente la tasa BCV (por ejemplo, cuando el usuario la escribe).
 * Dispara el evento 'tasaActualizada'.
 * @param {number|string} valor - Nuevo valor de tasa
 */
export function setTasaManual(valor) {
  const nuevaTasa = parseFloat(valor);
  if (!isNaN(nuevaTasa) && nuevaTasa > 0) {
    currentTasaBCV = nuevaTasa;
    // No actualizamos fecha porque es manual
    window.dispatchEvent(new CustomEvent('tasaActualizada', {
      detail: { tasa: currentTasaBCV, fecha: currentFechaTasa }
    }));
    console.log(`💰 Tasa BCV manual: ${currentTasaBCV} Bs/USD`);
  }
}

/**
 * Retorna la tasa actual (útil para cálculos síncronos)
 * @returns {number|null}
 */
export function getTasaActual() {
  return currentTasaBCV;
}

/**
 * Retorna la fecha de la última actualización de tasa
 * @returns {string|null}
 */
export function getFechaTasa() {
  return currentFechaTasa;
}

/**
 * Escucha cambios de tasa (útil para módulos que necesitan reaccionar)
 * @param {function} callback - Función a ejecutar cuando la tasa cambie
 */
export function onTasaChange(callback) {
  window.addEventListener('tasaActualizada', (e) => callback(e.detail));
}