import { createHash } from 'node:crypto';
import { claveDeItem, huellaDeClave } from './guardia';
import type { ItemEscalacion } from './escalaciones';

// ═══════════════════════════════════════════════════════════════════════════
// DE FALLA REAL A REGRESIÓN (F14-B, PLAN-MAESTRO §10.4): «Convertir en caso de examen».
//
// Desde un renglón de Escalaciones (escalación, corrida fallida, liquidación en revisión) se genera un caso REDACTADO que el
// dueño DESCARGA como JSON y guarda en el corpus FUERA de git (ver docs/operacion/casos-de-examen.md). Sin migración: no se
// guarda nada en la base.
//
// REDACCIÓN: todo texto pasa por `redactarTexto` (RFC, CURP, teléfonos, correos, UUID, CLABE/números largos, placas, nombres
// tras una etiqueta de persona) y el nombre de la flota se reemplaza por un seudónimo. Después `hayDatoPersonal` revisa el JSON
// FINAL: si queda algo con forma de dato personal, el caso NO se entrega (falla cerrado). Los nombres propios sueltos no se
// pueden detectar con reglas; por eso el caso lleva la advertencia de revisarlo a ojo antes de guardarlo.
// ═══════════════════════════════════════════════════════════════════════════

const PATRONES: ReadonlyArray<{ etiqueta: string; re: RegExp }> = [
  { etiqueta: 'CORREO', re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
  { etiqueta: 'UUID', re: /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi },
  { etiqueta: 'CURP', re: /\b[A-Z]{4}\d{6}[HM][A-Z]{5}[A-Z0-9]\d\b/gi },
  { etiqueta: 'RFC', re: /\b[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}\b/gi },
  { etiqueta: 'NUMERO', re: /\b\d{8,}\b/g },
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (título/detalle de una alerta) y cuantificadores con tope
  { etiqueta: 'TELEFONO', re: /(?:\+?\s?52[\s-]?)?(?:\(?\d{2,3}\)?[\s.-]?){2,3}\d{2,4}(?!\d)/g },
  { etiqueta: 'PLACA', re: /\b[A-Z]{2,3}-\d{2,3}-\d{1,2}\b|\b\d{2}-[A-Z]{2}-[A-Z]{2}\b/g },
  // eslint-disable-next-line security/detect-unsafe-regex -- entrada acotada (título/detalle de una alerta) y cuantificadores con tope
  { etiqueta: 'NOMBRE', re: /\b(chofer|operador|conductor|titular|contacto|nombre|cliente)\s*[:=-]?\s+((?:[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+)(?:\s+(?:de\s+|del\s+|la\s+)?[A-ZÁÉÍÓÚÑ][a-záéíóúñ]+){0,3})/g },
];

/** Redacta un texto y cuenta cuántos fragmentos reemplazó. */
export function redactarTexto(texto: string): { texto: string; reemplazos: number } {
  let reemplazos = 0;
  let t = texto;
  for (const { etiqueta, re } of PATRONES) {
    t = t.replace(re, (...m) => {
      reemplazos++;
      return etiqueta === 'NOMBRE' ? `${m[1]} [NOMBRE]` : `[${etiqueta}]`;
    });
  }
  return { texto: t, reemplazos };
}

/** ¿Queda algo con forma de dato personal? Revisa el JSON final con los mismos patrones (menos NOMBRE, ya enmascarado). */
export function hayDatoPersonal(valor: unknown): string[] {
  const s = JSON.stringify(valor);
  const hallados: string[] = [];
  for (const { etiqueta, re } of PATRONES) {
    if (etiqueta === 'NOMBRE') continue;
    const r = new RegExp(re.source, re.flags);
    if (r.test(s)) hallados.push(etiqueta);
  }
  return hallados;
}

export interface CasoExamen {
  version: 1;
  id: string;
  origen: { fuente: string; severidad_sugerida: string | null };
  /** Lo que el sistema recibió o vio, ya redactado. */
  entrada: { titulo: string; detalle: string | null; flota: string; desde_dias_atras: number; vence: boolean };
  /** Lo que el humano debe llenar antes de guardarlo: el resultado correcto. Nunca se inventa. */
  esperado: { estado: 'por_llenar'; nota: string };
  redaccion: { fragmentos_reemplazados: number };
  advertencias: string[];
}

export interface OpcionesCaso { ahoraMs: number; flotaSeudonimo?: string }

/** PURA. Del renglón de la bandeja al caso redactado. LANZA si, tras redactar, queda un dato personal (falla cerrado). */
export function casoDeEscalacion(item: ItemEscalacion, op: OpcionesCaso): CasoExamen {
  const t = redactarTexto(item.titulo);
  const d = item.detalle ? redactarTexto(item.detalle) : null;
  const clave = huellaDeClave(claveDeItem({ fuente: item.fuente, titulo: item.titulo, flota: item.tenantNombre, desde: item.desde, huella: item.huella }));
  const dias = Math.max(0, Math.floor((op.ahoraMs - Date.parse(item.desde)) / 86_400_000));
  const caso: CasoExamen = {
    version: 1,
    id: `caso-${createHash('sha256').update(clave).digest('hex').slice(0, 12)}`,
    origen: { fuente: item.fuente, severidad_sugerida: null },
    entrada: {
      titulo: t.texto, detalle: d?.texto ?? null, flota: op.flotaSeudonimo ?? 'FLOTA_A',
      desde_dias_atras: Number.isFinite(dias) ? dias : 0, vence: item.vence !== null,
    },
    esperado: { estado: 'por_llenar', nota: 'Escribe aquí el resultado correcto antes de guardar el caso en el corpus. El sistema no lo adivina.' },
    redaccion: { fragmentos_reemplazados: t.reemplazos + (d?.reemplazos ?? 0) },
    advertencias: [
      'Los nombres propios sueltos no se detectan por reglas: léelo antes de guardarlo.',
      'No lo agregues al repositorio: el corpus de casos vive fuera de git.',
    ],
  };
  const resto = hayDatoPersonal(caso);
  if (resto.length > 0) throw new Error(`El caso conserva datos con forma de ${resto.join(', ')}: no se entrega.`);
  return caso;
}

/** La llave estable de un renglón (la misma huella que usa la guardia) para pedirlo por URL sin mandar su contenido. */
export function claveDeEscalacion(item: ItemEscalacion): string {
  return huellaDeClave(claveDeItem({ fuente: item.fuente, titulo: item.titulo, flota: item.tenantNombre, desde: item.desde, huella: item.huella }));
}

export function urlCasoExamen(item: ItemEscalacion): string {
  return `/api/admin/caso-examen?fuente=${encodeURIComponent(item.fuente)}&clave=${claveDeEscalacion(item)}`;
}
