// ═══════════════════════════════════════════════════════════════════════════
// LECTOR E — ORDEN DE REMISIÓN DE UN AGENTE ADUANAL — T-A3-60.
//
// PDF con texto de una importación: CONTROL No., ORIGEN, REMITENTE, IMPORTADOR (con su RFC), CAJA NO., PLACAS, SELLO y una
// tabla REF / CANTIDAD / CLASE / CONTENIDO / PEDIMENTO / PESO (KG). Se lee SIN modelo, por rótulo.
//
// Reglas:
//  · El pedimento llega como `patente-consecutivo` (11 dígitos): se conserva así, con su aviso. El año y la aduana NO se
//    inventan aquí: los completa `completarDerivados` con los del perfil, o una persona.
//  · El peso en kg trae coma de miles («6,577.50»): se lee como miles solo si el propio documento lo demuestra; una cifra
//    ambigua sigue marcada como ambigua.
//  · El régimen no viene: queda vacío (IMPO → IMD lo infiere T-A3-62 y lo marca «inferido»).
//  · El sello de la caja no tiene campo en el complemento: se conserva en `adicionales`, no se descarta ni se inventa un campo.
//  · «INSTRUCCIONES: DESTINO …» puede no coincidir con el destino del Excel emparejado: se guarda en `adicionales`, no se usa.
//  · Un renglón de la tabla que no encaja con el encabezado NO se adivina: `renglon_no_leido`.
// ═══════════════════════════════════════════════════════════════════════════

import { extraccionVacia, type CampoValor, type Extraccion } from '../campos';
import type { ContenidoDoc } from '../contenido';
import {
  campoLeido, completarDerivados, detectarSeparadorMiles, leerRenglonPorColumnas, ordenDeColumnas, pendientesDeEnriquecimiento,
  type ClaveColumna, type IncidenciaLector, type ResultadoLector,
} from '../derivar';
import { PEDIMENTO_PARCIAL } from '../normalizar';

const CONF_ROTULO = 0.97;
const RFC_FORMA = '[A-ZÑ&]{3,4}\\d{6}[A-Z0-9]{3}';

const REGEX = {
  control: /^control\s*(?:no\.?|#|n[uú]mero)?\s*[:.]\s*(.+)$/i,
  origen: /^origen\s*:\s*(.+)$/i,
  remitente: /^remitente\s*:\s*(.+)$/i,
  importador: /^importador\s*:\s*(.+)$/i,
  rfcImportador: /^rfc(?:\s+del)?(?:\s+importador)?\s*:\s*(.+)$/i,
  consignado: /^consignad[oa]\s*:\s*(.+)$/i,
  caja: /^caja\s*(?:no\.?|#|n[uú]mero)\s*[:.]\s*(.+)$/i,
  placas: /^placas?\s*:\s*(.+)$/i,
  sello: /^sellos?\s*:\s*(.+)$/i,
  instrucciones: /^instrucciones\s*:\s*(.+)$/i,
} as const;

const COLUMNAS: ReadonlyArray<readonly [ClaveColumna, RegExp]> = [
  ['ref', /\bref(?:erencia)?\b/i], ['cantidad', /\b(?:cantidad|cant)\b/i], ['tipo', /\b(?:clase|embalaje|bulto)\b/i],
  ['descripcion', /\b(?:contenido|descripci[oó]n|mercanc[ií]a)\b/i], ['pedimento', /\b(?:pedimento|ped)\b/i], ['peso', /\bpeso\b/i],
];

export function leerOrdenAgente(c: ContenidoDoc): ResultadoLector {
  const e: Extraccion = extraccionVacia();
  const avisos: string[] = [...c.avisos]; const incidencias: IncidenciaLector[] = [];
  const adicionales: Record<string, string> = {};
  const fin = (leido: boolean): ResultadoLector => ({ formato: 'E', leido, extraccion: e, avisos, incidencias, vacios: pendientesDeEnriquecimiento(e), adicionales });
  if (c.texto === null || c.formato !== 'pdf_texto') {
    avisos.push('El lector de la orden del agente aduanal necesita el texto del PDF; este documento no lo trae. Sigue el flujo genérico y una persona lo confirma.');
    return fin(false);
  }
  const lineas = c.texto.split(/\r?\n/).map((l) => l.trim());

  const buscar = (re: RegExp): { valor: string; linea: string } | null => {
    for (const l of lineas) { const m = re.exec(l); if (m && m[1].trim() !== '') return { valor: m[1].trim(), linea: l }; }
    return null;
  };
  const poner = (clave: string, r: { valor: string; linea: string } | null, texto?: string): void => {
    if (!r) return;
    const cv = campoLeido(clave, false, texto ?? r.valor, { confianza: CONF_ROTULO, evidencia: r.linea });
    if (cv) e.campos[clave] = cv;
  };

  poner('folio_cliente', buscar(REGEX.control));
  poner('origen_domicilio', buscar(REGEX.origen));
  poner('origen_nombre', buscar(REGEX.remitente));
  poner('destino_nombre', buscar(REGEX.consignado));
  poner('caja_numero', buscar(REGEX.caja));
  poner('unidad_placas', buscar(REGEX.placas));
  const sello = buscar(REGEX.sello); if (sello) adicionales.sello = sello.valor;
  const instr = buscar(REGEX.instrucciones); if (instr) adicionales.instrucciones = instr.valor;

  // Importador y su RFC (en la misma línea o en su propia línea).
  const imp = buscar(REGEX.importador);
  let rfcImp: { valor: string; linea: string } | null = null;
  if (imp) {
    const m = new RegExp(`\\bRFC\\b\\s*[:.]?\\s*(${RFC_FORMA})\\b`, 'i').exec(imp.valor);
    if (m) rfcImp = { valor: m[1], linea: imp.linea };
    adicionales.importador = imp.valor.replace(new RegExp(`\\s*\\bRFC\\b\\s*[:.]?\\s*${RFC_FORMA}\\b`, 'i'), '').trim();
  }
  if (!rfcImp) { const r = buscar(REGEX.rfcImportador); if (r && new RegExp(`^${RFC_FORMA}$`, 'i').test(r.valor.replace(/[\s-]/g, ''))) rfcImp = r; }

  // La tabla.
  const i = lineas.findIndex((l) => /\bcantidad\b/i.test(l) && /\bpedimento\b/i.test(l) && /\bpeso\b/i.test(l) && !/:/.test(l));
  const orden = i < 0 ? [] : ordenDeColumnas(lineas[i], COLUMNAS);
  const filasCrudas: Array<{ valores: Partial<Record<ClaveColumna, string>>; linea: string }> = [];
  if (i >= 0) {
    let espacios = false;
    for (const linea of lineas.slice(i + 1)) {
      if (linea === '' || /^(instrucciones|total|observaciones|firma)\b/i.test(linea)) break;
      const r = leerRenglonPorColumnas(linea, orden);
      if (r) { filasCrudas.push({ valores: r.valores, linea: orden.map((k) => r.valores[k]).filter((v): v is string => !!v).join(' | ') }); if (r.modo === 'espacios') espacios = true; }
      else {
        incidencias.push({ codigo: 'renglon_no_leido', campo: null, renglon: null, detalle: `Un renglón de la tabla no encaja con el encabezado y no se leyó (no se adivina): «${linea.slice(0, 80)}».` });
        avisos.push('Hay renglones de la tabla que no se pudieron leer: captúralos a mano.');
      }
    }
    if (espacios) avisos.push('Las columnas de la tabla vienen separadas por espacios simples: la frontera entre columnas (clase / contenido) se dedujo por la forma de cada cifra. Revísala contra el documento.');
  } else avisos.push('No se encontró la tabla REF / CANTIDAD / CONTENIDO / PEDIMENTO / PESO de la orden.');

  const miles = detectarSeparadorMiles(filasCrudas.map((f) => f.valores.peso ?? ''));
  filasCrudas.forEach((f, n) => {
    const fila: Record<string, CampoValor> = {};
    const put = (clave: string, k: ClaveColumna): void => {
      const crudo = f.valores[k] ?? '';
      if (crudo === '') return;
      const cv = campoLeido(clave, true, crudo, { confianza: CONF_ROTULO, evidencia: f.linea, miles });
      if (cv) fila[clave] = cv;
    };
    put('cantidad', 'cantidad');
    put('unidad_texto', 'tipo');
    put('descripcion', 'descripcion');
    put('pedimento', 'pedimento');
    put('peso_kg', 'peso');
    if (fila.peso_kg) fila.peso_unidad = { valor: 'KGM', confianza: fila.peso_kg.confianza, evidencia: f.linea, origen: 'perfil' };
    if (rfcImp) {
      const r = campoLeido('rfc_importador', true, rfcImp.valor, { confianza: CONF_ROTULO, evidencia: rfcImp.linea });
      if (r) fila.rfc_importador = r;
    }
    if (fila.pedimento && PEDIMENTO_PARCIAL.test(fila.pedimento.valor ?? '')) {
      incidencias.push({ codigo: 'pedimento_incompleto', campo: 'pedimento', renglon: n, detalle: 'El pedimento viene como patente-consecutivo: faltan el año y la aduana. No se inventaron; se completan con el perfil o a mano.' });
    }
    if (Object.keys(fila).length > 0) e.mercancias.push(fila);
  });
  if (incidencias.some((x) => x.codigo === 'pedimento_incompleto')) avisos.push('Pedimento incompleto (patente-consecutivo): faltan el año y la aduana. Confírmalos con el agente aduanal.');

  completarDerivados(e);
  if (e.mercancias.length === 0) avisos.push('No se leyó ningún renglón de mercancía de la orden.');
  return fin(e.mercancias.length > 0);
}
