// ═══════════════════════════════════════════════════════════════════════════
// XML — el único formato que NO necesita modelo.
//
// Un CFDI con complemento Carta Porte (2.0/3.0/3.1) ya trae los campos con su
// nombre oficial. Leerlo con un LLM sería pagar por adivinar lo que está
// escrito: se lee por código, con confianza 0.99 (es dato estructurado, no
// lectura) y sin costo de modelo. Un XML que NO es Carta Porte (el formato propio
// de un cliente) sigue por el camino del perfil/LLM.
// ═══════════════════════════════════════════════════════════════════════════

import { CAMPOS_DOC, CAMPOS_MERCANCIA, extraccionVacia, type CampoDoc, type CampoValor, type Extraccion } from './campos';
import { normalizarValor } from './normalizar';
import { campoDestino, campoOrigen } from './plantilla_tms';
import { MAX_DESTINOS_NUEVA, MAX_ORIGENES_NUEVA } from './plantilla_tms.layout';

type Nodo = Record<string, unknown>;

const esNodo = (v: unknown): v is Nodo => typeof v === 'object' && v !== null && !Array.isArray(v);
export const aArray = <T>(v: T | T[] | undefined | null): T[] => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

/** Baja por claves (sin prefijos de namespace). `undefined` si algún tramo no existe. */
export function bajar(arbol: unknown, ...ruta: string[]): unknown {
  let actual: unknown = arbol;
  for (const k of ruta) {
    if (Array.isArray(actual)) actual = actual[0];
    if (!esNodo(actual)) return undefined;
    actual = actual[k];
  }
  return actual;
}

const attr = (n: unknown, a: string): string | null => {
  if (!esNodo(n)) return null;
  const v = n[`@_${a}`];
  return typeof v === 'string' && v.trim() !== '' ? v : null;
};

const XML_CONF = 0.99;

function poner(
  campos: Record<string, CampoValor>,
  defs: ReadonlyArray<CampoDoc>,
  clave: string,
  crudo: string | null,
  evidencia: string,
): void {
  if (crudo === null) return;
  const def = defs.find((d) => d.clave === clave);
  if (!def) return;
  const n = normalizarValor(def, crudo);
  if (n.valor === null) return;
  campos[clave] = {
    valor: n.valor,
    confianza: Math.max(0, XML_CONF - n.penalizacion),
    evidencia,
    origen: 'xml',
    ...(n.notas.length > 0 ? { notas: n.notas } : {}),
  };
}

/** Lo que lee el XML y lo que NO pudo mapear (se dice, no se calla). */
export interface LecturaXmlCcp { extraccion: Extraccion; avisos: string[] }

/** `null` si el árbol no trae un nodo CartaPorte. Compatible: solo la extracción. */
export function extraerCartaPorteXml(arbol: unknown): Extraccion | null {
  return leerCartaPorteXml(arbol)?.extraccion ?? null;
}

/** `null` si el árbol no trae un nodo CartaPorte. */
export function leerCartaPorteXml(arbol: unknown): LecturaXmlCcp | null {
  const comprobante = bajar(arbol, 'Comprobante');
  const ccp = bajar(comprobante, 'Complemento', 'CartaPorte') ?? bajar(arbol, 'CartaPorte');
  if (!esNodo(ccp)) return null;

  const e = extraccionVacia();
  const c = e.campos;
  const avisos: string[] = [];
  const serie = attr(comprobante, 'Serie');
  const folio = attr(comprobante, 'Folio');
  poner(c, CAMPOS_DOC, 'folio_cliente', folio ? `${serie ?? ''}${folio}` : null, 'Comprobante@Folio');
  poner(c, CAMPOS_DOC, 'transp_internac', attr(ccp, 'TranspInternac'), 'CartaPorte@TranspInternac');

  const ubicaciones = aArray(bajar(ccp, 'Ubicaciones', 'Ubicacion'));
  const origenes = ubicaciones.filter((u) => attr(u, 'TipoUbicacion') === 'Origen');
  const destinos = ubicaciones.filter((u) => attr(u, 'TipoUbicacion') === 'Destino');
  const origen = origenes[0];
  const destino = destinos[destinos.length - 1];
  const aplicarUbicacion = (u: unknown, p: 'origen' | 'destino', rotulo: string, n = 1) => {
    if (!u) return;
    const k = (base: string): string => (p === 'origen' ? campoOrigen(base, n) : campoDestino(base, n));
    // Las claves `destino_N_…` / `origen_N_…` no están en CAMPOS_DOC: se normalizan con la definición del primero.
    const ponerU = (campo: string, crudo: string | null, evidencia: string): void => {
      const def = CAMPOS_DOC.find((d) => d.clave === `${p}_${campo}`);
      if (!def || crudo === null) return;
      const nv = normalizarValor(def, crudo);
      if (nv.valor === null) return;
      c[k(`${p}_${campo}`)] = { valor: nv.valor, confianza: Math.max(0, XML_CONF - nv.penalizacion), evidencia, origen: 'xml', ...(nv.notas.length > 0 ? { notas: nv.notas } : {}) };
    };
    const rot = n === 1 ? rotulo : `${rotulo}#${n}`;
    ponerU('nombre', attr(u, 'NombreRemitenteDestinatario'), `${rot}@NombreRemitenteDestinatario`);
    ponerU('rfc', attr(u, 'RFCRemitenteDestinatario'), `${rot}@RFCRemitenteDestinatario`);
    ponerU('cp', attr(bajar(u, 'Domicilio'), 'CodigoPostal'), `${rot}/Domicilio@CodigoPostal`);
    ponerU('estado', attr(bajar(u, 'Domicilio'), 'Estado'), `${rot}/Domicilio@Estado`);
    const calle = attr(bajar(u, 'Domicilio'), 'Calle');
    const num = attr(bajar(u, 'Domicilio'), 'NumeroExterior');
    const col = attr(bajar(u, 'Domicilio'), 'Colonia');
    ponerU('domicilio', [calle, num, col].filter(Boolean).join(' ') || null, `${rot}/Domicilio`);
  };
  // A37-S33-01: se leen TODOS los orígenes y destinos (hasta lo que el producto admite); lo que no cabe se AVISA y baja la confianza.
  origenes.slice(0, MAX_ORIGENES_NUEVA).forEach((u, i) => aplicarUbicacion(u, 'origen', 'Ubicacion[Origen]', i + 1));
  const leidosDest = destinos.slice(0, MAX_DESTINOS_NUEVA);
  leidosDest.forEach((u, i) => aplicarUbicacion(u, 'destino', 'Ubicacion[Destino]', i + 1));
  if (origenes.length > MAX_ORIGENES_NUEVA || destinos.length > MAX_DESTINOS_NUEVA) {
    avisos.push(`El XML trae ${destinos.length} destinos y ${origenes.length} orígenes; solo se leyeron ${leidosDest.length} destinos y ${Math.min(origenes.length, MAX_ORIGENES_NUEVA)} orígenes. Revisa el resto a mano.`);
    for (const k of Object.keys(c)) if (/^(origen|destino)_/.test(k)) c[k] = { ...c[k], confianza: Math.min(c[k].confianza, 0.5), notas: [...(c[k].notas ?? []), 'El XML trae más ubicaciones de las que se pudieron leer: confirma el trayecto completo.'] };
  } else if (origenes.length > 1 || destinos.length > 1) {
    avisos.push(`El XML trae ${origenes.length} origen(es) y ${destinos.length} destino(s): se leyeron todos (destino 1 a ${destinos.length}).`);
  }
  poner(c, CAMPOS_DOC, 'fecha_salida', attr(origen, 'FechaHoraSalidaLlegada'), 'Ubicacion[Origen]@FechaHoraSalidaLlegada');
  poner(c, CAMPOS_DOC, 'fecha_llegada', attr(destino, 'FechaHoraSalidaLlegada'), 'Ubicacion[Destino]@FechaHoraSalidaLlegada');
  poner(c, CAMPOS_DOC, 'distancia_km', attr(ccp, 'TotalDistRec'), 'CartaPorte@TotalDistRec');

  const mercancias = bajar(ccp, 'Mercancias');
  poner(c, CAMPOS_DOC, 'peso_bruto_total', attr(mercancias, 'PesoBrutoTotal'), 'Mercancias@PesoBrutoTotal');
  const veh = bajar(mercancias, 'Autotransporte', 'IdentificacionVehicular');
  poner(c, CAMPOS_DOC, 'unidad_placas', attr(veh, 'PlacaVM'), 'IdentificacionVehicular@PlacaVM');
  const remolque = aArray(bajar(mercancias, 'Autotransporte', 'Remolques', 'Remolque'))[0];
  poner(c, CAMPOS_DOC, 'remolque_placas', attr(remolque, 'Placa'), 'Remolque@Placa');

  const figuras = aArray(bajar(ccp, 'FiguraTransporte', 'TiposFigura'));
  const op = figuras.find((f) => attr(f, 'TipoFigura') === '01');
  poner(c, CAMPOS_DOC, 'operador_nombre', attr(op, 'NombreFigura'), 'TiposFigura[01]@NombreFigura');
  poner(c, CAMPOS_DOC, 'operador_rfc', attr(op, 'RFCFigura'), 'TiposFigura[01]@RFCFigura');
  poner(c, CAMPOS_DOC, 'operador_licencia', attr(op, 'NumLicencia'), 'TiposFigura[01]@NumLicencia');

  for (const m of aArray(bajar(mercancias, 'Mercancia'))) {
    const fila: Record<string, CampoValor> = {};
    poner(fila, CAMPOS_MERCANCIA, 'descripcion', attr(m, 'Descripcion'), 'Mercancia@Descripcion');
    poner(fila, CAMPOS_MERCANCIA, 'bienes_transp', attr(m, 'BienesTransp'), 'Mercancia@BienesTransp');
    poner(fila, CAMPOS_MERCANCIA, 'fraccion_arancelaria', attr(m, 'FraccionArancelaria'), 'Mercancia@FraccionArancelaria');
    poner(fila, CAMPOS_MERCANCIA, 'cantidad', attr(m, 'Cantidad'), 'Mercancia@Cantidad');
    poner(fila, CAMPOS_MERCANCIA, 'clave_unidad', attr(m, 'ClaveUnidad'), 'Mercancia@ClaveUnidad');
    poner(fila, CAMPOS_MERCANCIA, 'unidad_texto', attr(m, 'Unidad'), 'Mercancia@Unidad');
    poner(fila, CAMPOS_MERCANCIA, 'peso_kg', attr(m, 'PesoEnKg'), 'Mercancia@PesoEnKg');
    poner(fila, CAMPOS_MERCANCIA, 'embalaje', attr(m, 'Embalaje'), 'Mercancia@Embalaje');
    poner(fila, CAMPOS_MERCANCIA, 'valor_mercancia', attr(m, 'ValorMercancia'), 'Mercancia@ValorMercancia');
    poner(fila, CAMPOS_MERCANCIA, 'moneda', attr(m, 'Moneda'), 'Mercancia@Moneda');
    poner(fila, CAMPOS_MERCANCIA, 'material_peligroso', attr(m, 'MaterialPeligroso'), 'Mercancia@MaterialPeligroso');
    // A37-S33-01: a qué destino/origen va cada mercancía (posición 1..N), por CantidadTransporta@IDDestino / @IDOrigen.
    const posDestino = (id: string | null): number => (id === null ? 0 : destinos.findIndex((u) => attr(u, 'IDUbicacion') === id) + 1);
    const posOrigen = (id: string | null): number => (id === null ? 0 : origenes.findIndex((u) => attr(u, 'IDUbicacion') === id) + 1);
    const cants = aArray(bajar(m, 'CantidadTransporta'));
    const dests = [...new Set(cants.map((q) => posDestino(attr(q, 'IDDestino'))).filter((n) => n > 0))];
    const origs = [...new Set(cants.map((q) => posOrigen(attr(q, 'IDOrigen'))).filter((n) => n > 0))];
    const numMerc = e.mercancias.length + 1;
    if (dests.length === 1 && destinos.length > 1) fila.id_destino = { valor: String(dests[0]), confianza: XML_CONF, evidencia: 'Mercancia/CantidadTransporta@IDDestino', origen: 'xml' };
    else if (dests.length > 1) avisos.push(`Mercancía ${numMerc}: el XML la reparte entre varios destinos (${dests.join(', ')}); no se asignó destino, confírmalo a mano.`);
    if (origs.length === 1 && origenes.length > 1) fila.id_origen = { valor: String(origs[0]), confianza: XML_CONF, evidencia: 'Mercancia/CantidadTransporta@IDOrigen', origen: 'xml' };
    else if (origs.length > 1) avisos.push(`Mercancía ${numMerc}: el XML la reparte entre varios orígenes (${origs.join(', ')}); no se asignó origen, confírmalo a mano.`);
    e.mercancias.push(fila);
  }
  return { extraccion: e, avisos };
}
