import { DatoInvalido } from './errores';
import type { LikidaConfig } from './config';

// ═══════════════════════════════════════════════════════════════════════════
// AJUSTES OPERATIVOS DE LA FLOTA — la parte de `tenant.config` que el CLIENTE
// puede cambiar solo, sin pedírselo a Likida.
//
// Hasta el 14-ago-2026, `/dashboard/configuracion` era 168 líneas SIN UN SOLO
// formulario: enseñaba el tabulador y el catálogo de cuentas como quien enseña
// una placa conmemorativa. Un contralor cuyos tractocamiones rinden 2.4 km/L y
// no 3.0 tenía el motor calculando mal el diésel esperado de CADA viaje, y su
// única salida era escribirle a Javier.
//
// LO QUE SE PUEDE TOCAR Y LO QUE NO — el corte no es de UI, es legal:
//
//   SÍ (parámetros del NEGOCIO de la flota):
//     · tabulador  — cómo rinden SUS unidades y a qué precio compran diésel
//     · cuentas    — el catálogo contable de SU contador
//     · salida     — el formato que traga SU ERP
//
//   NO (parámetros de la LEY, aunque vivan en el mismo jsonb):
//     · estimulos.peajeFactor (0.5 = LIF 2026 Art. 20-A)
//     · estimulos.clavesDieselIeps / clavesPeaje (claves del SAT)
//     · hidrocarburos.claves / vigenteDesde (RMF 2.7.1.48, DOF)
//     · validacion.fechaToleranciaDiasAntes
//   Esos NO tienen formulario a propósito. Una flota que se sube el
//   `peajeFactor` a 0.8 no está configurando su software: está declarando un
//   estímulo que la ley no le da, con nuestro PDF como evidencia. Si un día la
//   ley cambia el 50%, lo cambiamos nosotros en el default, para todos.
//
// La validación vive aquí, PURA, para que la use la pantalla (avisos mientras
// se teclea) y el servidor (la que de verdad manda) — un solo juego de reglas,
// como `validarConfigCobranza`.
// ═══════════════════════════════════════════════════════════════════════════

export type FormatoSalida = LikidaConfig['salida'];

export const FORMATOS: ReadonlyArray<{ valor: FormatoSalida; rotulo: string; detalle: string }> = [
  { valor: 'csv', rotulo: 'CSV genérico', detalle: 'Lo lee Excel y casi cualquier ERP. Es el default.' },
  { valor: 'contpaqi_txt', rotulo: 'CONTPAQi (TXT)', detalle: 'Layout de póliza para importar en CONTPAQi.' },
  { valor: 'aspel_xls', rotulo: 'Aspel (XLS)', detalle: 'Hoja para importar en Aspel COI.' },
];

/** Lo que llega del formulario: strings, porque un `<input>` no da números. */
export interface AjustesCrudos {
  rendimientoPorDefecto: string;
  factorCarga: string;
  precioDieselPorDefecto: string;
  /** En PORCENTAJE tal como se teclea (15), no en fracción (0.15). */
  umbralDesviacionPct: string;
  salida: string;
  /** Una línea por cuenta: `concepto=600-001`. Es lo que el contador ya tiene
   *  en un Excel y puede pegar de golpe. */
  cuentas: string;
}

export interface AjustesValidos {
  tabulador: LikidaConfig['tabulador'];
  catalogoCuentas: Record<string, string>;
  salida: FormatoSalida;
}

/** Rangos con su porqué. No son gustos: fuera de aquí el motor produce
 *  números que ningún contralor va a creer, y "creíble" es el producto. */
const RANGOS = {
  // Un tractocamión full anda entre 2 y 3.5 km/L. Se abre a 0.5–20 para no
  // pelearse con una flota de camionetas o de utilitarios, pero 0 haría una
  // división entre cero y 100 km/L no existe en carga.
  rendimiento: { min: 0.5, max: 20 },
  // Cargado siempre consume MÁS que vacío, así que el factor va por debajo de
  // 1. Un factor > 1 invertiría la relación y el motor esperaría menos diésel
  // en el viaje cargado — el error se leería como "el chofer se robó menos".
  factorCarga: { min: 0.3, max: 1 },
  // El diésel en México no ha estado por debajo de $15 ni cerca de $99.
  precioDiesel: { min: 5, max: 99 },
  // 0% marcaría CADA viaje (todo se desvía algo) y 100% no marcaría ninguno.
  umbralPct: { min: 1, max: 90 },
} as const;

function numero(crudo: string, campo: string, rango: { min: number; max: number }): number {
  const t = crudo.trim();
  if (t === '') throw new DatoInvalido(`Falta ${campo}.`);
  // `Number('')` es 0 y `Number('  ')` también — de ahí el guard de arriba.
  const n = Number(t.replace(',', '.'));
  if (!Number.isFinite(n)) throw new DatoInvalido(`${campo} tiene que ser un número.`);
  if (n < rango.min || n > rango.max) {
    throw new DatoInvalido(`${campo} tiene que estar entre ${rango.min} y ${rango.max}.`);
  }
  return n;
}

/**
 * El catálogo contable, tecleado como `concepto=cuenta`, una por línea.
 *
 * Se acepta pegar el bloque entero: es como el contador lo tiene en su Excel.
 * Un renglón vacío se ignora; uno sin `=` es un error CON su número de línea,
 * porque "formato inválido" a secas sobre 40 renglones no ayuda a nadie.
 */
export function parsearCuentas(crudo: string): Record<string, string> {
  const cuentas: Record<string, string> = {};
  const lineas = crudo.split('\n');

  for (let i = 0; i < lineas.length; i++) {
    const linea = lineas[i].trim();
    if (linea === '') continue;

    const corte = linea.indexOf('=');
    if (corte === -1) {
      throw new DatoInvalido(`Línea ${i + 1}: falta el "=" (se escribe así: diesel=600-001).`);
    }

    const concepto = linea.slice(0, corte).trim().toLowerCase();
    const cuenta = linea.slice(corte + 1).trim();
    if (!concepto) throw new DatoInvalido(`Línea ${i + 1}: falta el concepto antes del "=".`);
    if (!cuenta) throw new DatoInvalido(`Línea ${i + 1}: falta la cuenta después del "=".`);
    if (cuenta.length > 40) throw new DatoInvalido(`Línea ${i + 1}: la cuenta es demasiado larga.`);
    if (concepto in cuentas) {
      // Silenciarlo dejaría que la última línea gane sin avisar, y el contador
      // se quedaría buscando por qué su primera cuenta no se aplicó.
      throw new DatoInvalido(`Línea ${i + 1}: "${concepto}" ya tiene cuenta más arriba.`);
    }
    cuentas[concepto] = cuenta;
  }

  return cuentas;
}

/** Al revés: de la config al textarea. */
export function formatearCuentas(cuentas: Record<string, string>): string {
  return Object.entries(cuentas)
    .sort(([a], [b]) => a.localeCompare(b, 'es'))
    .map(([c, n]) => `${c}=${n}`)
    .join('\n');
}

export function esFormato(v: string): v is FormatoSalida {
  return FORMATOS.some((f) => f.valor === v);
}

/**
 * Valida TODO y devuelve el objeto listo para guardar. Tira `DatoInvalido`
 * con un mensaje en palabras de pantalla — el mismo texto que ve el usuario.
 *
 * El umbral entra en PORCENTAJE y sale en FRACCIÓN: el motor lo usa como
 * `0.15`, pero nadie teclea "0.15" cuando quiere decir 15%. La conversión vive
 * aquí, en un solo lugar, y no en la pantalla — si viviera allá, el servidor
 * podría guardar 15 donde el motor espera 0.15 y marcaría CERO desviaciones
 * en vez de todas, sin un solo error en el log.
 */
export function validarAjustes(c: AjustesCrudos): AjustesValidos {
  const rendimientoPorDefecto = numero(c.rendimientoPorDefecto, 'El rendimiento por defecto (km/L)', RANGOS.rendimiento);
  const factorCarga = numero(c.factorCarga, 'El factor de carga', RANGOS.factorCarga);
  const precioDieselPorDefecto = numero(c.precioDieselPorDefecto, 'El precio del diésel', RANGOS.precioDiesel);
  const umbralPct = numero(c.umbralDesviacionPct, 'El umbral de desviación (%)', RANGOS.umbralPct);

  const salida = c.salida.trim();
  if (!esFormato(salida)) throw new DatoInvalido('El formato de salida no es uno de los disponibles.');

  const catalogoCuentas = parsearCuentas(c.cuentas);
  if (Object.keys(catalogoCuentas).length === 0) {
    // Un catálogo vacío deja al export sin cuenta contable en cada renglón, y
    // el archivo llega al ERP para rebotar completo.
    throw new DatoInvalido('El catálogo de cuentas no puede quedar vacío.');
  }

  return {
    tabulador: {
      rendimientoPorDefecto,
      factorCarga,
      precioDieselPorDefecto,
      // Redondeo a 4 decimales: 15/100 en punto flotante es 0.15000000000000002
      // y esa cola se guarda tal cual en el jsonb y se ve en pantalla.
      umbralDesviacion: Math.round((umbralPct / 100) * 10000) / 10000,
    },
    catalogoCuentas,
    salida,
  };
}
