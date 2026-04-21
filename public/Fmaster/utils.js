// public/Fmaster/utils.js
// Utilidades generales y helpers para el DOM

/**
 * Formatea una fecha ISO a formato local dd/mm/aaaa
 * @param {string} fechaString - Fecha en formato ISO
 * @returns {string} Fecha formateada o '—' si es inválida
 */
export function formatearFecha(fechaString) {
  if (!fechaString) return '—';
  const fecha = new Date(fechaString);
  if (isNaN(fecha.getTime())) return '—';
  return fecha.toLocaleDateString('es-ES', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
}

/**
 * Escapa caracteres HTML para prevenir XSS
 * @param {string} str - Texto a escapar
 * @returns {string} Texto escapado
 */
export function escapeHtml(str) {
  if (!str) return '';
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return str.replace(/[&<>"']/g, m => map[m]);
}

/**
 * Selector abreviado para querySelector
 * @param {string} selector - Selector CSS
 * @param {Element} context - Elemento contexto (por defecto document)
 * @returns {Element|null} Elemento encontrado
 */
export function $(selector, context = document) {
  return context.querySelector(selector);
}

/**
 * Selector abreviado para querySelectorAll (devuelve Array)
 * @param {string} selector - Selector CSS
 * @param {Element} context - Elemento contexto (por defecto document)
 * @returns {Array<Element>} Array de elementos encontrados
 */
export function $$(selector, context = document) {
  return Array.from(context.querySelectorAll(selector));
}

/**
 * Muestra una notificación temporal (puede expandirse)
 * @param {string} mensaje - Mensaje a mostrar
 * @param {string} tipo - 'success', 'error', 'info'
 */
export function notificar(mensaje, tipo = 'info') {
  // Implementación básica con alert, puede mejorarse con un sistema de toast
  alert(mensaje);
}

/**
 * Valida si un string tiene formato de período MM/AAAA
 * @param {string} periodo - Período a validar
 * @returns {boolean} True si es válido
 */
export function validarPeriodo(periodo) {
  return /^(0[1-9]|1[0-2])\/\d{4}$/.test(periodo);
}

/**
 * Redondea un número a dos decimales
 * @param {number} valor - Número a redondear
 * @returns {number} Número redondeado
 */
export function redondearUSD(valor) {
  return Math.round(valor * 100) / 100;
}