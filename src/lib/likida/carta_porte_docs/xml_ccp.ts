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

/** `null` si el árbol no trae un nodo CartaPorte. */
export function extraerCartaPorteXml(arbol: unknown): Extraccion | null {
  const comprobante = bajar(arbol, 'Comprobante');
  const ccp = bajar(comprobante, 'Complemento', 'CartaPorte') ?? bajar(arbol, 'CartaPorte');
  if (!esNodo(ccp)) return null;

  const e = extraccionVacia();
  const c = e.campos;
  const serie = attr(comprobante, 'Serie');
  const folio = attr(comprobante, 'Folio');
  poner(c, CAMPOS_DOC, 'folio_cliente', folio ? `${serie ?? ''}${folio}` : null, 'Comprobante@Folio');
  poner(c, CAMPOS_DOC, 'transp_internac', attr(ccp, 'TranspInternac'), 'CartaPorte@TranspInternac');

  const ubicaciones = aArray(bajar(ccp, 'Ubicaciones', 'Ubicacion'));
  const origen = ubicaciones.find((u) => attr(u, 'TipoUbicacion') === 'Origen');
  const destinos = ubicaciones.filter((u) => attr(u, 'TipoUbicacion') === 'Destino');
  const destino = destinos[destinos.length - 1];
  const aplicarUbicacion = (u: unknown, p: 'origen' | 'destino', rotulo: string) => {
    if (!u) return;
    poner(c, CAMPOS_DOC, `${p}_nombre`, attr(u, 'NombreRemitenteDestinatario'), `${rotulo}@NombreRemitenteDestinatario`);
    poner(c, CAMPOS_DOC, `${p}_rfc`, attr(u, 'RFCRemitenteDestinatario'), `${rotulo}@RFCRemitenteDestinatario`);
    poner(c, CAMPOS_DOC, `${p}_cp`, attr(bajar(u, 'Domicilio'), 'CodigoPostal'), `${rotulo}/Domicilio@CodigoPostal`);
    poner(c, CAMPOS_DOC, `${p}_estado`, attr(bajar(u, 'Domicilio'), 'Estado'), `${rotulo}/Domicilio@Estado`);
    const calle = attr(bajar(u, 'Domicilio'), 'Calle');
    const num = attr(bajar(u, 'Domicilio'), 'NumeroExterior');
    const col = attr(bajar(u, 'Domicilio'), 'Colonia');
    poner(c, CAMPOS_DOC, `${p}_domicilio`, [calle, num, col].filter(Boolean).join(' ') || null, `${rotulo}/Domicilio`);
  };
  aplicarUbicacion(origen, 'origen', 'Ubicacion[Origen]');
  aplicarUbicacion(destino, 'destino', 'Ubicacion[Destino]');
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
    e.mercancias.push(fila);
  }
  return e;
}
