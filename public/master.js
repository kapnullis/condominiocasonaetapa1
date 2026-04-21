// public/master.js
// Punto de entrada modular para el panel Master
// Carga dinámica de todos los módulos desde la carpeta Fmaster/

console.log('🖥️ Master UI cargada (modular)');

// Importar el núcleo que orquesta todos los módulos
import { inicializarMaster } from './Fmaster/core.js';

// Iniciar la aplicación cuando el DOM esté listo
document.addEventListener('DOMContentLoaded', inicializarMaster);