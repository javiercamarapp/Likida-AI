// ═══════════════════════════════════════════════════════════════════════════
// LECTOR F2 — correo/captura con el bloque «Datos para CP:» — T-A3-61.
//
// Forma real de la muestra: encabezado «Datos para CP:», luego «Lugar de origen:» con el domicilio en líneas sueltas (parque,
// razón social, calle, «ciudad, estado CP», «RFC: …»), y la carga en líneas SIN rótulo («194 piezas», «7,185.07 KGM», «Clave de
// producto 56111800 Muebles…») mezcladas con rótulos con dos puntos («Unidad de medida: H87», «Fracción arancelaria: …»,
// «Tipo de materia: 3 producto terminado», «Documento: 1 Pedimento», «Régimen aduanero: EXD»). El tipo de documento no tiene
// campo en el complemento: se conserva en `adicionales`. En una exportación no hay número de pedimento: queda vacío.
// ═══════════════════════════════════════════════════════════════════════════

import type { CampoValor, Extraccion } from '../campos';
import type { ContenidoDoc } from '../contenido';
import type { ResultadoLector } from '../derivar';
import { leerRotulosCorreo, llaveRotulo, separarInterfaz } from '../rotulos';
import { CONF_CORREO, CONF_TEXTO_LIBRE, campoDeTexto, cerrarLectorCorreo, resolucionDe, sinTexto, textoDeCorreo, type OpcionesLectorCorreo } from './correo';

const RFC = '[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}';
const EMPRESA = /(?:\bS\.?\s?A\.?\s?P\.?\s?I\.?|\bS\.?\s?A\.?|\bS\.?\s?de\s?R\.?\s?L\.?|\bINC\b\.?|\bLLC\b|\bCORP\b\.?)(?:\s*de\s*C\.?\s?V\.?)?\s*$/i;
const CIUDAD_ESTADO_CP = /^(.*?),\s*([^,\d]+?)\s+(\d{5})$/;
const PESO_LIBRE = /^(\d[\d.,]*)\s*(KGM|KGS?|KILOS?|KILOGRAMOS?|TON\w*|TNE|LBS?|LBR|LIBRAS?)\b\.?$/i;
const CANTIDAD_LIBRE = /^(\d[\d.,]*)\s*(piezas?|pzas?|pz|cajas?|bultos?|cartones?|tarimas?|pallets?)\b\.?$/i;
const PRODUCTO_LIBRE = /^clave\s+(?:de\s+)?producto(?:\s+sat)?\s*:?\s*(\d{8})\b\s*(.*)$/i;
const ENCABEZADO_LUGAR = /^lugar\s+de\s+(origen|destino)\s*:?\s*$/i;

/** Lee el domicilio en líneas sueltas que sigue a «Lugar de origen:» / «Lugar de destino:». */
function leerLugar(lineas: string[], desde: number, prefijo: 'origen' | 'destino', e: Extraccion, transcrita: boolean): void {
  const piezas: string[] = [];
  let nombre: { v: string; l: string } | null = null;
  let k = desde + 1;
  for (; k < lineas.length && lineas[k].trim() !== ''; k++) {
    const l = lineas[k].trim();
    const rfc = new RegExp(`^(?:RFC|R\\.F\\.C\\.?)\\s*:?\\s*(${RFC})\\b`, 'i').exec(l);
    if (rfc) { const cv = campoDeTexto(`${prefijo}_rfc`, false, rfc[1], l, CONF_CORREO, transcrita); if (cv) e.campos[`${prefijo}_rfc`] = cv; continue; }
    const ce = CIUDAD_ESTADO_CP.exec(l);
    if (ce) {
      const cp = campoDeTexto(`${prefijo}_cp`, false, ce[3], l, CONF_CORREO, transcrita); if (cp) e.campos[`${prefijo}_cp`] = cp;
      const st = campoDeTexto(`${prefijo}_estado`, false, ce[2], l, CONF_TEXTO_LIBRE, transcrita); if (st) e.campos[`${prefijo}_estado`] = st;
      piezas.push(l);
      continue;
    }
    if (!nombre && EMPRESA.test(l)) { nombre = { v: l, l }; continue; }
    piezas.push(l);
  }
  if (nombre) { const cv = campoDeTexto(`${prefijo}_nombre`, false, nombre.v, nombre.l, CONF_CORREO, transcrita); if (cv) e.campos[`${prefijo}_nombre`] = cv; }
  if (piezas.length > 0) { const cv = campoDeTexto(`${prefijo}_domicilio`, false, piezas.join(', '), piezas.join(' / '), CONF_TEXTO_LIBRE, transcrita); if (cv) e.campos[`${prefijo}_domicilio`] = cv; }
}

export function leerCorreoF2(c: ContenidoDoc, o: OpcionesLectorCorreo = {}): ResultadoLector {
  const { texto, transcrita } = textoDeCorreo(c, o);
  if (!texto) return sinTexto('F2', c);
  const lec = leerRotulosCorreo(texto, { resolucion: resolucionDe(c), origen: transcrita ? 'llm' : 'perfil' });
  const e: Extraccion = lec ? lec.extraccion : { campos: {}, mercancias: [] };
  const { lineas } = separarInterfaz(texto);
  const llaveEncabezado = lineas.findIndex((l) => llaveRotulo(l.replace(/:\s*$/, '')) === 'datos para cp');
  const lineasBloque = llaveEncabezado >= 0 ? lineas.slice(llaveEncabezado + 1) : lineas;
  if (llaveEncabezado < 0 && !lec?.firma) return cerrarLectorCorreo('F2', e, lec, { avisos: ['No se encontró el bloque «Datos para CP:» en el correo.'] });

  // Domicilio de origen y de destino (líneas sueltas bajo su encabezado).
  lineasBloque.forEach((l, i) => {
    const m = ENCABEZADO_LUGAR.exec(l.trim());
    if (m) leerLugar(lineasBloque, i, m[1].toLowerCase() === 'origen' ? 'origen' : 'destino', e, transcrita);
  });

  // La carga en líneas sin rótulo.
  const fila: Record<string, CampoValor> = e.mercancias[0] ?? {};
  for (const l0 of lineasBloque) {
    const l = l0.trim();
    let m: RegExpExecArray | null;
    if ((m = PRODUCTO_LIBRE.exec(l))) {
      const k = campoDeTexto('bienes_transp', true, m[1], l, CONF_CORREO, transcrita); if (k && !fila.bienes_transp) fila.bienes_transp = k;
      if (m[2].trim() !== '') { const d = campoDeTexto('descripcion', true, m[2].trim(), l, CONF_CORREO, transcrita); if (d && !fila.descripcion) fila.descripcion = d; }
    } else if ((m = CANTIDAD_LIBRE.exec(l))) {
      const q = campoDeTexto('cantidad', true, m[1], l, CONF_TEXTO_LIBRE, transcrita); if (q && !fila.cantidad) fila.cantidad = q;
      const u = campoDeTexto('unidad_texto', true, m[2], l, CONF_TEXTO_LIBRE, transcrita); if (u && !fila.unidad_texto) fila.unidad_texto = u;
    } else if ((m = PESO_LIBRE.exec(l))) {
      const p = campoDeTexto('peso_kg', true, m[1], l, CONF_TEXTO_LIBRE, transcrita, ['El correo no dice si es peso bruto o neto: confírmalo.']); if (p && !fila.peso_kg) fila.peso_kg = p;
      const pu = campoDeTexto('peso_unidad', true, m[2], l, CONF_TEXTO_LIBRE, transcrita); if (pu && !fila.peso_unidad) fila.peso_unidad = pu;
    }
  }
  if (Object.keys(fila).length > 0 && e.mercancias.length === 0) e.mercancias.push(fila);
  return cerrarLectorCorreo('F2', e, lec, { resolucion: resolucionDe(c) });
}
