// ═══════════════════════════════════════════════════════════════════════════
// DERIVADOS — lo que se calcula de lo que el documento SÍ dice.
//
// Idempotente: se puede correr tras la extracción y tras cada corrección humana
// sin acumular efectos. Nunca pisa un valor que un humano dejó (`origen: humano`)
// y nunca inventa: solo convierte unidades y suma renglones.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor, Extraccion } from './campos';
import { FACTOR_A_KG, claveUnidadDeTexto } from './catalogos';
import { PEDIMENTO_PARCIAL, normalizarNumero } from './normalizar';
import { tipoOperacion } from './validacion';

const num = (c: CampoValor | undefined): number | null => (c?.valor != null ? normalizarNumero(c.valor).valor : null);
/** Nota fija (y por eso idempotente) cuando solo hay peso neto o «peso por embalaje» y se usa como bruto. */
export const NOTA_NETO_COMO_BRUTO = 'El documento solo da el peso neto (o «peso por embalaje»): se usó como peso bruto por defecto. Pendiente de confirmar con el cliente.';
const redondea = (n: number): string => String(Math.round(n * 1000) / 1000);

/** Lo que el llamador sabe de FUERA del documento (T-A3-46). Sin él, los derivados de aduana no actúan. */
export interface ContextoDerivar {
  /** Nombre del archivo recibido: `CCP <transportista>-<cliente final> <IMPO|EXPO> <caja> <dd-mm-aa>`. */
  nombreArchivo?: string | null;
  /** Año (2 dígitos) y aduana (2 dígitos) del perfil, para completar un pedimento `patente-consecutivo`. */
  pedimentoPerfil?: { anio: string; aduana: string } | null;
}

/** IMPO/EXPO y caja del nombre del archivo. Solo pistas: el nombre lo pone una persona y trae versiones `(1)` y mojibake. */
export function metadatosNombreArchivo(nombre: string | null | undefined): { operacion: 'importacion' | 'exportacion' | null; caja: string | null } {
  const limpio = (nombre ?? '').replace(/[ÂÃ]/g, ' ').replace(/\.[A-Za-z0-9]{2,4}$/, '');
  const m = /(?:^|[^A-Za-z])(IMPO|EXPO)(?![A-Za-z])[\s_]+([A-Za-z0-9][A-Za-z0-9-]{0,14})?/i.exec(limpio);
  if (!m) return { operacion: null, caja: null };
  const caja = m[2] && !/^\d{1,2}-\d{1,2}-\d{2,4}$/.test(m[2]) ? m[2].toUpperCase() : null;
  return { operacion: m[1].toUpperCase() === 'IMPO' ? 'importacion' : 'exportacion', caja };
}

const REGIMEN_DE_OPERACION = { importacion: 'IMD', exportacion: 'EXD' } as const;

/** Régimen, pedimento y caja a partir del contexto. Nunca pisa lo que un humano dejó ni inventa un pedimento. */
function derivarAduana(e: Extraccion, ctx: ContextoDerivar): void {
  const meta = metadatosNombreArchivo(ctx.nombreArchivo);
  // Régimen: si el documento lo trae en algún renglón, vale para todos; si no, la pista del nombre del archivo.
  const dado = e.campos.regimen_aduanero ?? e.mercancias.map((f) => f.regimen_aduanero).find((c) => c?.valor);
  if (e.mercancias.length > 0) {
    const base: CampoValor | null = dado?.valor
      ? dado
      : meta.operacion
        ? { valor: REGIMEN_DE_OPERACION[meta.operacion], confianza: 0.6, evidencia: meta.operacion === 'importacion' ? 'IMPO' : 'EXPO', origen: 'derivado', notas: [`Se dedujo del nombre del archivo (${meta.operacion === 'importacion' ? 'IMPO' : 'EXPO'}): confirma el régimen.`] }
        : null;
    if (base) for (const fila of e.mercancias) if (!fila.regimen_aduanero?.valor) fila.regimen_aduanero = { ...base };
  }
  // Caja: solo como pista del nombre del archivo cuando el documento no la trae.
  if (!e.campos.caja_numero?.valor && meta.caja) {
    e.campos.caja_numero = { valor: meta.caja, confianza: 0.6, evidencia: null, origen: 'derivado', notas: ['La caja salió del nombre del archivo: confírmala contra el documento.'] };
  }
  const op = tipoOperacion(e);
  const perfil = ctx.pedimentoPerfil && /^\d{2}$/.test(ctx.pedimentoPerfil.anio) && /^\d{2}$/.test(ctx.pedimentoPerfil.aduana) ? ctx.pedimentoPerfil : null;
  for (const fila of e.mercancias) {
    if (op === 'exportacion') {
      // En exportación no hay pedimento ni RFC del importador (Guía de llenado): se vacían aunque el texto los mencione,
      // con o sin pedimento en la fila (un RFC solo también se omite).
      for (const k of ['pedimento', 'rfc_importador']) if (fila[k]?.valor && fila[k].origen !== 'humano') fila[k] = { ...fila[k], valor: null, notas: [...(fila[k].notas ?? []), 'Se omitió: en una exportación no lleva pedimento ni RFC del importador.'] };
      continue;
    }
    const ped = fila.pedimento;
    if (!ped?.valor || ped.origen === 'humano') continue;
    if (perfil && PEDIMENTO_PARCIAL.test(ped.valor)) {
      const [patente, consecutivo] = ped.valor.split('-');
      fila.pedimento = {
        ...ped, valor: `${perfil.anio} ${perfil.aduana} ${patente} ${consecutivo}`, confianza: Math.min(ped.confianza, 0.7), origen: 'derivado',
        notas: [...(ped.notas ?? []), `Se completó el año (${perfil.anio}) y la aduana (${perfil.aduana}) con los del perfil: confírmalos.`],
      };
    }
  }
}

export function completarDerivados(e: Extraccion, ctx: ContextoDerivar = {}): Extraccion {
  derivarAduana(e, ctx);
  for (const fila of e.mercancias) {
    // 1. El peso llegó en OTRA unidad (ton, lb, g): se convierte a kg y se anota.
    const unidadPeso = fila.peso_unidad?.valor ? claveUnidadDeTexto(fila.peso_unidad.valor) : null;
    const peso = fila.peso_kg;
    if (peso && peso.origen !== 'humano' && unidadPeso && unidadPeso !== 'KGM' && FACTOR_A_KG[unidadPeso] !== undefined) {
      const n = num(peso);
      if (n !== null) {
        fila.peso_kg = {
          ...peso,
          valor: redondea(n * FACTOR_A_KG[unidadPeso]),
          notas: [...(peso.notas ?? []), `${unidadPeso === 'LBR' ? 'Convertido de libras' : `El documento da el peso en ${unidadPeso}`}: se convirtió a kilogramos (×${FACTOR_A_KG[unidadPeso]}).`],
        };
        fila.peso_unidad = { ...fila.peso_unidad!, valor: 'KGM' };
      }
    }
    // 1a. El documento solo da el peso NETO (o el «peso por embalaje»): el complemento pide el BRUTO. Por defecto se usa
    //     ese número como bruto y se deja la nota (decisión pendiente del cliente, pregunta 10); nunca se descarta en silencio.
    const tipoPeso = (fila.peso_tipo?.valor ?? '').trim().toLowerCase();
    if (fila.peso_kg?.valor && fila.peso_kg.origen !== 'humano' && /^(neto|peso neto|por embalaje|peso por embalaje|embalaje)$/.test(tipoPeso) && !(fila.peso_kg.notas ?? []).includes(NOTA_NETO_COMO_BRUTO)) {
      fila.peso_kg = { ...fila.peso_kg, notas: [...(fila.peso_kg.notas ?? []), NOTA_NETO_COMO_BRUTO] };
    }
    // 1b. Una «clave» numérica de 1 o 2 dígitos («20», «1») no es del SAT: el valor se conserva como texto de la unidad
    //     (sin pisar uno existente) y la validación pide confirmar la clave.
    const claveCruda = fila.clave_unidad?.valor;
    if (claveCruda && /^\d{1,2}$/.test(claveCruda) && fila.clave_unidad.origen !== 'humano' && !fila.unidad_texto?.valor) {
      fila.unidad_texto = { ...fila.clave_unidad, notas: [...(fila.clave_unidad.notas ?? []), `«${claveCruda}» venía como clave de unidad pero no es una clave SAT; se conserva como texto.`] };
    }
    // 2. La clave de unidad sale del texto de la unidad cuando es inequívoco.
    if (!fila.clave_unidad?.valor && fila.unidad_texto?.valor) {
      const k = claveUnidadDeTexto(fila.unidad_texto.valor);
      if (k) fila.clave_unidad = { valor: k, confianza: Math.min(0.9, fila.unidad_texto.confianza), evidencia: fila.unidad_texto.evidencia, origen: 'derivado', notas: [`«${fila.unidad_texto.valor}» se tradujo a ${k}.`] };
    }
    // 3. Cantidad en kg o toneladas y sin peso aparte: el peso ES la cantidad.
    const clave = fila.clave_unidad?.valor;
    if (!fila.peso_kg?.valor && fila.cantidad?.valor && (clave === 'KGM' || clave === 'TNE')) {
      const q = num(fila.cantidad);
      if (q !== null) {
        fila.peso_kg = {
          valor: redondea(q * FACTOR_A_KG[clave]),
          confianza: Math.min(0.9, fila.cantidad.confianza),
          evidencia: fila.cantidad.evidencia,
          origen: 'derivado',
          notas: [`La cantidad está en ${clave}: el peso en kg se derivó de ella.`],
        };
      }
    }
  }
  // 4. El peso bruto total, de la suma de renglones, si el documento no lo da.
  const actual = e.campos.peso_bruto_total;
  if ((!actual || actual.origen === 'derivado') && e.mercancias.length > 0) {
    const pesos = e.mercancias.map((f) => num(f.peso_kg));
    if (pesos.every((p): p is number => p !== null)) {
      const confs = e.mercancias.map((f) => f.peso_kg.confianza);
      e.campos.peso_bruto_total = {
        valor: redondea(pesos.reduce((s, p) => s + p, 0)),
        confianza: Math.min(...confs),
        evidencia: null,
        origen: 'derivado',
        notas: ['Suma de los pesos de las mercancías.'],
      };
    } else if (actual?.origen === 'derivado') {
      delete e.campos.peso_bruto_total;
    }
  }
  return e;
}
