// ═══════════════════════════════════════════════════════════════════════════
// RESOLUCIÓN DEL PAC (0226) — de variables de entorno a proveedor, o a la
// verdad de que no hay ninguno.
//
// Variables (en Vercel; JAMÁS en el repo):
//   LIKIDA_PAC_PROVEEDOR      'sw' (único hoy; la capa es pluggable)
//   LIKIDA_PAC_URL            base del ambiente, p. ej.
//                             https://services.test.sw.com.mx (sandbox)
//                             https://services.sw.com.mx      (producción)
//   LIKIDA_PAC_USUARIO        usuario/correo de la cuenta del PAC
//   LIKIDA_PAC_PASSWORD       su contraseña
//
// Sin las cuatro NO hay PAC: `resolverPac()` devuelve null, el botón de
// timbrar ni aparece y ningún camino simula un timbre. Configurarlas es el
// acto que enciende el circuito — sandbox primero (las credenciales demo de
// SW son públicas en su documentación), producción cuando Javier firme el
// contrato del PAC y la flota tenga su CSD en la bóveda.
// ═══════════════════════════════════════════════════════════════════════════

import { crearProveedorSw } from './sw';
import type { ProveedorPac } from './tipos';

export type { ProveedorPac, ResultadoTimbre, TimbreOk, TimbreError } from './tipos';

export interface EstadoPac {
  configurado: boolean;
  proveedor: string | null;
  /** true si la URL apunta al ambiente de pruebas conocido del proveedor —
   *  informativo para la pantalla; el modo QUE MANDA es el de flota_fiscal. */
  pareceSandbox: boolean | null;
}

export function estadoPac(): EstadoPac {
  const p = resolverPac();
  if (p === null) return { configurado: false, proveedor: null, pareceSandbox: null };
  const url = process.env.LIKIDA_PAC_URL ?? '';
  return { configurado: true, proveedor: p.nombre, pareceSandbox: url.includes('.test.') };
}

export function resolverPac(): ProveedorPac | null {
  const proveedor = process.env.LIKIDA_PAC_PROVEEDOR?.trim() ?? '';
  const urlBase = process.env.LIKIDA_PAC_URL?.trim().replace(/\/+$/, '') ?? '';
  const usuario = process.env.LIKIDA_PAC_USUARIO?.trim() ?? '';
  const password = process.env.LIKIDA_PAC_PASSWORD ?? '';
  if (proveedor === '' || urlBase === '' || usuario === '' || password === '') return null;
  if (proveedor !== 'sw') return null; // proveedor desconocido = no configurado, jamás adivinar
  return crearProveedorSw({ urlBase, usuario, password });
}
