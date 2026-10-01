// ═══════════════════════════════════════════════════════════════════════════
// LA FORMA DE REVISIÓN → cambios. PURO (sin React ni base), para probarlo.
//
// Los nombres de los campos de la forma son un contrato entre la pantalla y el
// servidor:
//
//   c:<clave>        un campo del documento              (c:origen_cp)
//   m:<renglón>:<clave>  un campo de una mercancía       (m:0:peso_kg · m:2:descripcion = renglón NUEVO)
//   k:<c|m…>         casilla «confirmado» del mismo campo (k:c:origen_cp · k:m:0:peso_kg)
//
// El servidor NO confía en la forma: solo cambia lo que de verdad difiere de lo guardado (enviar la
// forma entera sin tocar nada no confirma ni corrige nada) y valida cada valor como al leerlo.
// ═══════════════════════════════════════════════════════════════════════════

import { CLAVES_DOC, CLAVES_MERCANCIA, MAX_MERCANCIAS, type Extraccion } from './campos';
import type { CambioCampo } from './bandeja';

const RE_DOC = /^c:([a-z_]+)$/;
const RE_MERC = /^m:(\d{1,3}):([a-z_]+)$/;
const RE_CONF = /^k:(c:[a-z_]+|m:\d{1,3}:[a-z_]+)$/;

/** Cuánto puede medir un valor que llega de la forma (el servidor además lo normaliza y lo acota por campo). */
const MAX_VALOR = 600;

export interface FormaLeida { cambios: CambioCampo[]; ignorados: string[] }

export function cambiosDeFormulario(fd: FormData, ext: Extraccion): FormaLeida {
  const confirmados = new Set<string>();
  for (const [k, v] of fd.entries()) if (RE_CONF.test(k) && v !== '' && v !== 'off') confirmados.add(k.slice(2));

  const cambios: CambioCampo[] = [];
  const ignorados: string[] = [];
  for (const [nombre, crudo] of fd.entries()) {
    if (typeof crudo !== 'string') { if (/^[cmk]:/.test(nombre)) ignorados.push(nombre); continue; }
    let m: RegExpExecArray | null;
    if ((m = RE_DOC.exec(nombre))) {
      if (!CLAVES_DOC.includes(m[1])) { ignorados.push(nombre); continue; }
      cambios.push({ campo: m[1], renglon: null, valor: crudo.slice(0, MAX_VALOR), confirmar: confirmados.has(`c:${m[1]}`) });
    } else if ((m = RE_MERC.exec(nombre))) {
      const i = Number(m[1]);
      if (!CLAVES_MERCANCIA.includes(m[2]) || i > ext.mercancias.length || i >= MAX_MERCANCIAS) { ignorados.push(nombre); continue; }
      cambios.push({ campo: m[2], renglon: i, valor: crudo.slice(0, MAX_VALOR), confirmar: confirmados.has(`m:${i}:${m[2]}`) });
    }
  }
  // Una casilla «confirmado» sin su campo en la forma (campo vacío que no se mandó) se ignora a propósito.
  return { cambios, ignorados };
}
