// public/Fmaster/core.js
// Módulo central: inicialización, autenticación y coordinación entre módulos

import { api } from './api.js';
import { obtenerTasaBCV } from './tasa.js';
import { initRecibos, setRecalcularCallbacks, cargarRecibos, verRecibo } from './recibos.js';
import { cargarGruposParaDeudas, initDeudasModal, grupos } from './deudas.js';
import { cargarPagosPendientes } from './pagos.js';
import { recalcularTodo, actualizarUSDEnGastosEspecificos } from './ui.js';
import { $ } from './utils.js';

// Exponer funciones necesarias para botones generados dinámicamente (onclick)
window.verRecibo = verRecibo;

/**
 * Configura las dependencias entre módulos
 */
function configurarCallbacks() {
  setRecalcularCallbacks(recalcularTodo, actualizarUSDEnGastosEspecificos);
}

/**
 * Verifica la autenticación y redirige si es necesario
 */
async function verificarAutenticacion() {
  const token = localStorage.getItem('token');
  const rol = localStorage.getItem('rol');

  if (!token || rol !== 'master') {
    localStorage.removeItem('token');
    localStorage.removeItem('rol');
    window.location.href = '/login.html';
    throw new Error('Acceso no autorizado');
  }

  // Verificar que el token sea válido haciendo una petición simple
  try {
    await api.getGrupos();
  } catch (err) {
    console.error('Error de autenticación:', err);
    localStorage.removeItem('token');
    localStorage.removeItem('rol');
    window.location.href = '/login.html';
    throw err;
  }
}

/**
 * Configura el botón de logout
 */
function configurarLogout() {
  const logoutBtn = $('#logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', () => {
      localStorage.removeItem('token');
      localStorage.removeItem('rol');
      window.location.href = '/login.html';
    });
  }
}

/**
 * Configura listeners globales para cerrar modales con tecla ESC
 */
function configurarCierreModales() {
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const modales = $$('.modal');
      modales.forEach(modal => {
        if (modal.style.display === 'block') {
          modal.style.display = 'none';
        }
      });
    }
  });
}

/**
 * Función principal de inicialización
 */
export async function inicializarMaster() {
  try {
    // 1. Verificar autenticación
    await verificarAutenticacion();

    // 2. Configurar callbacks entre módulos
    configurarCallbacks();

    // 3. Configurar elementos globales de UI
    configurarLogout();
    configurarCierreModales();

    // 4. Inicializar módulos en orden
    // Cargar grupos (necesario para otros módulos)
    await cargarGruposParaDeudas();

    // Inicializar módulo de recibos (incluye carga inicial)
    await initRecibos(grupos);

    // Inicializar modal de deudas
    initDeudasModal();

    // Cargar pagos pendientes
    await cargarPagosPendientes();

    // Obtener tasa BCV inicial
    await obtenerTasaBCV();

    console.log('✅ Master UI inicializada correctamente');
  } catch (error) {
    console.error('❌ Error durante la inicialización:', error);
    // Si el error no es de autenticación, mostrar mensaje
    if (!error.message?.includes('Acceso no autorizado')) {
      alert('Error al cargar la aplicación. Recargue la página.');
    }
  }
}

// Exponer función para recarga manual si es necesario
window.recargarMaster = inicializarMaster;