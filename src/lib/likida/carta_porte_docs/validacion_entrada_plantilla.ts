// ═══════════════════════════════════════════════════════════════════════════
// VALIDACIÓN DE ENTRADAS A/B — completar lo de el transportista y avisar diferencias (T-A3-64).
//
// En los formatos A y B el cliente ya manda la plantilla del TMS llena; solo faltan las celdas «LLENA TRANSPORTISTA»
// (número de cliente interno, a veces caja, distancia y claves) y conviene vigilar la coherencia de embalaje y
// pedimento con el régimen (Guía de llenado, T-A3-45).
//
// Es PURA y no toca el libro: recibe la extracción ya leída (`leerPlantillaTms`), el catálogo del cliente y, si existe,
// el de distancias; devuelve una extracción nueva más el detalle de qué se completó, qué difiere y qué falta.
//
// Reglas (la ficha manda):
//   · Lo que llenó el cliente NUNCA se sobrescribe. Si el catálogo dice otra cosa, queda el valor del cliente y sale un
//     aviso visible «El catálogo dice X, el documento dice Y».
//   · Lo que falta y el catálogo sabe se completa y queda marcado «completado» (origen `catalogo` + nota).
//   · Lo que falta y no hay catálogo que lo resuelva es un BLOQUEO «falta dato»: no se inventa ningún valor.
//   · Dos coincidencias en un catálogo = ambiguo: no se aplica nada y se avisa.
//   · La coherencia embalaje/pedimento vs régimen sale de las reglas de la Guía (`validarReglasGuia`), solo como avisos.
// ═══════════════════════════════════════════════════════════════════════════

import { campoDoc, type CampoValor, type Extraccion } from './campos';
import { enriquecer, type CatalogoCliente, type ContextoCatalogo } from './catalogo_cliente';
import { llaveTexto } from './catalogos';
import { campoDestino, MAX_DESTINOS } from './plantilla_tms';
import { validarReglasGuia, type Hallazgo } from './validacion';

export type FormatoEntradaPlantilla = 'A' | 'B';

/** Una distancia conocida entre el origen del cliente y un destino suyo (catálogo de distancias, si la flota lo cargó). */
export interface DistanciaCat {
  tenantId: string;
  clienteId: string;
  /** Se busca por RFC/Tax ID del destino o, si no hay, por su nombre normalizado. */
  destinoRfc: string | null;
  destinoNombre: string | null;
  km: number;
}

export interface EntradaValidacionPlantilla {
  formato: FormatoEntradaPlantilla;
  extraccion: Extraccion;
  catalogo: CatalogoCliente | null | undefined;
  contexto: ContextoCatalogo;
  distancias?: readonly DistanciaCat[] | null;
}

export type TipoAviso = 'diferencia_catalogo' | 'ambiguo' | 'guia';

export interface AvisoEntrada {
  tipo: TipoAviso;
  campo: string;
  renglon: number | null;
  mensaje: string;
}

export interface FaltanteEntrada {
  campo: string;
  renglon: number | null;
  /** Siempre bloqueante: un dato que falta no se inventa. */
  bloqueante: true;
  mensaje: string;
}

export interface CompletadoEntrada {
  campo: string;
  renglon: number | null;
  valor: string;
  fuente: 'catalogo' | 'catalogo_distancias';
}

export interface ResultadoValidacionEntrada {
  extraccion: Extraccion;
  completados: CompletadoEntrada[];
  avisos: AvisoEntrada[];
  faltantes: FaltanteEntrada[];
  /** Hallazgos crudos de la Guía (embalaje/pedimento/tipo de materia…), por si la bandeja los quiere con su severidad. */
  hallazgosGuia: Hallazgo[];
  /** Lo que el cliente llenó y se conservó intacto (campos del documento + celdas de mercancías). */
  conservados: number;
}

export const NOTA_COMPLETADO = 'Completado: lo llenó el transportista desde el catálogo del cliente; el cliente no lo traía.';

const vacio = (c: CampoValor | undefined): boolean => !c || c.valor === null || String(c.valor).trim() === '';
const comparable = (v: string): string => v.toUpperCase().replace(/[\s.\-_]/g, '');
const compacto = (s: string): string => llaveTexto(s).replace(/[^a-z0-9]+/g, '');

const ROTULO_FALTA: Record<string, string> = {
  numero_cliente_interno: 'el número de cliente interno (celda «LLENA TRANSPORTISTA»)',
  caja_numero: 'el número de caja (obligatorio en la plantilla)',
};

function rotulo(campo: string): string {
  const base = campo.replace(/^destino_\d+_/, 'destino_');
  return ROTULO_FALTA[campo] ?? campoDoc(base)?.rotulo?.toLowerCase() ?? campo;
}

/** Copia de la extracción donde el destino N hace de «destino 1», para reusar el catálogo sin tocar su código. */
function proyectarDestino(e: Extraccion, n: number): Extraccion {
  const campos: Record<string, CampoValor> = {};
  for (const [k, v] of Object.entries(e.campos)) {
    if (!/^(destino_|contacto_destino_)/.test(k) || /^destino_\d+_/.test(k)) campos[k] = v;
  }
  for (const k of Object.keys(e.campos)) {
    if (k === 'distancia_km') continue;
    for (const base of baseDeDestino()) if (campoDestino(base, n) === k) campos[base] = e.campos[k];
  }
  // Los campos del destino 1 no deben colarse como destino N.
  for (const base of baseDeDestino()) if (!(campoDestino(base, n) in e.campos)) delete campos[base];
  return { campos, mercancias: [] };
}

function baseDeDestino(): string[] {
  return [
    'destino_nombre', 'destino_rfc', 'destino_calle', 'destino_num_ext', 'destino_num_int', 'destino_colonia_clave', 'destino_colonia',
    'destino_cp', 'destino_localidad_clave', 'destino_localidad', 'destino_municipio_clave', 'destino_municipio', 'destino_estado',
    'destino_pais', 'destino_id_fiscal', 'contacto_destino_nombre', 'contacto_destino_telefono', 'contacto_destino_correo',
  ];
}

const CLAVES_DOMICILIO = ['colonia_clave', 'localidad_clave', 'municipio_clave'] as const;

function numeroDestinos(e: Extraccion): number {
  let max = 1;
  for (const k of Object.keys(e.campos)) {
    const m = /^destino_(\d+)_/.exec(k);
    if (m && !vacio(e.campos[k])) max = Math.max(max, Number(m[1]));
  }
  return Math.min(max, MAX_DESTINOS);
}

function buscarDistancia(
  distancias: readonly DistanciaCat[], ctx: ContextoCatalogo, rfc: string, nombre: string,
): { tipo: 'unica'; km: number } | { tipo: 'ambigua' } | { tipo: 'ninguna' } {
  if (!ctx.clienteId) return { tipo: 'ninguna' };
  const propias = distancias.filter((d) => d.tenantId === ctx.tenantId && d.clienteId === ctx.clienteId);
  const porRfc = rfc !== '' ? propias.filter((d) => d.destinoRfc !== null && comparable(d.destinoRfc) === comparable(rfc)) : [];
  const hallados = porRfc.length > 0 ? porRfc
    : nombre !== '' ? propias.filter((d) => d.destinoNombre !== null && compacto(d.destinoNombre) === nombre) : [];
  if (hallados.length === 0) return { tipo: 'ninguna' };
  const kms = new Set(hallados.map((d) => d.km));
  if (kms.size > 1) return { tipo: 'ambigua' };
  const km = hallados[0].km;
  return Number.isFinite(km) && km > 0 ? { tipo: 'unica', km } : { tipo: 'ninguna' };
}

function marcarCompletado(c: CampoValor): CampoValor {
  return { ...c, notas: [...(c.notas ?? []).filter((n) => n !== NOTA_COMPLETADO), NOTA_COMPLETADO] };
}

export function validarEntradaPlantilla(entrada: EntradaValidacionPlantilla): ResultadoValidacionEntrada {
  const original = entrada.extraccion;
  const salida: Extraccion = structuredClone(original);
  const completados: CompletadoEntrada[] = [];
  const avisos: AvisoEntrada[] = [];
  const faltantes: FaltanteEntrada[] = [];

  const llenoCliente = (c: CampoValor | undefined): boolean => !vacio(c);

  // ── 1. Catálogo del cliente: documento (remitente, destino 1, número interno) y mercancías ───────────────────────
  const r = enriquecer(salida, entrada.catalogo, entrada.contexto);
  for (const a of r.ambiguos) avisos.push({ tipo: 'ambiguo', campo: a.split(':')[0], renglon: null, mensaje: `Catálogo del cliente, ambiguo: ${a}.` });
  const enriquecida = r.extraccion;

  // Garantía dura: nada de lo que el cliente llenó cambia de valor, ni siquiera si el catálogo lo «cedería» por confianza baja.
  for (const [k, v] of Object.entries(original.campos)) {
    if (!llenoCliente(v)) continue;
    const ahora = enriquecida.campos[k];
    if (!ahora || ahora.valor !== v.valor) enriquecida.campos[k] = structuredClone(v);
  }
  original.mercancias.forEach((fila, i) => {
    for (const [k, v] of Object.entries(fila)) {
      if (!llenoCliente(v)) continue;
      const ahora = enriquecida.mercancias[i]?.[k];
      if (!ahora || ahora.valor !== v.valor) enriquecida.mercancias[i][k] = structuredClone(v);
    }
  });

  // Marca de lo completado y aviso de diferencias (de campos que el cliente SÍ llenó).
  for (const [k, v] of Object.entries(enriquecida.campos)) {
    const antes = original.campos[k];
    if (v.origen === 'catalogo' && !llenoCliente(antes) && !(antes?.origen === 'humano' && llenoCliente(antes))) {
      enriquecida.campos[k] = marcarCompletado(v);
      completados.push({ campo: k, renglon: null, valor: String(v.valor), fuente: 'catalogo' });
    } else if (llenoCliente(antes)) {
      const nuevas = (v.notas ?? []).filter((n) => n.startsWith('El catálogo dice') && !(antes?.notas ?? []).includes(n));
      for (const n of nuevas) avisos.push({ tipo: 'diferencia_catalogo', campo: k, renglon: null, mensaje: `${rotulo(k)}: ${n} Se conservó lo del cliente.` });
    }
  }
  enriquecida.mercancias.forEach((fila, i) => {
    for (const [k, v] of Object.entries(fila)) {
      const antes = original.mercancias[i]?.[k];
      if (v.origen === 'catalogo' && !llenoCliente(antes)) {
        fila[k] = marcarCompletado(v);
        completados.push({ campo: k, renglon: i, valor: String(v.valor), fuente: 'catalogo' });
      } else if (llenoCliente(antes)) {
        const nuevas = (v.notas ?? []).filter((n) => n.startsWith('El catálogo dice') && !(antes?.notas ?? []).includes(n));
        for (const n of nuevas) avisos.push({ tipo: 'diferencia_catalogo', campo: k, renglon: i, mensaje: `Mercancía ${i + 1} · ${k}: ${n} Se conservó lo del cliente.` });
      }
    }
  });

  // ── 2. Destinos 2..N: mismo catálogo, proyectados como «destino 1» ────────────────────────────────────────────────
  const nDest = numeroDestinos(enriquecida);
  for (let n = 2; n <= nDest; n++) {
    const proy = proyectarDestino(enriquecida, n);
    const rp = enriquecer(proy, entrada.catalogo, entrada.contexto);
    for (const a of rp.ambiguos) avisos.push({ tipo: 'ambiguo', campo: `destino_${n}`, renglon: null, mensaje: `Catálogo del cliente, ambiguo en el destino ${n}: ${a}.` });
    for (const base of baseDeDestino()) {
      const v = rp.extraccion.campos[base];
      const clave = campoDestino(base, n);
      const antes = enriquecida.campos[clave];
      if (!v) continue;
      if (v.origen === 'catalogo' && !llenoCliente(antes)) {
        enriquecida.campos[clave] = marcarCompletado(v);
        completados.push({ campo: clave, renglon: null, valor: String(v.valor), fuente: 'catalogo' });
      } else if (llenoCliente(antes)) {
        const nuevas = (v.notas ?? []).filter((x) => x.startsWith('El catálogo dice') && !(antes?.notas ?? []).includes(x));
        for (const x of nuevas) avisos.push({ tipo: 'diferencia_catalogo', campo: clave, renglon: null, mensaje: `${rotulo(clave)} (destino ${n}): ${x} Se conservó lo del cliente.` });
      }
    }
  }

  // ── 3. Distancia por destino ──────────────────────────────────────────────────────────────────────────────────────
  for (let n = 1; n <= nDest; n++) {
    const clave = campoDestino('distancia_km', n);
    const rfc = String(enriquecida.campos[campoDestino('destino_rfc', n)]?.valor ?? '');
    const nombre = compacto(String(enriquecida.campos[campoDestino('destino_nombre', n)]?.valor ?? ''));
    const hallada = buscarDistancia(entrada.distancias ?? [], entrada.contexto, rfc, nombre);
    const actual = enriquecida.campos[clave];
    if (llenoCliente(actual)) {
      if (hallada.tipo === 'unica') {
        const dado = Number(String(actual!.valor).replace(',', '.'));
        if (Number.isFinite(dado) && Math.abs(dado - hallada.km) > 0.5) {
          const msg = `La distancia del catálogo es ${hallada.km} km y el documento dice ${actual!.valor} km. Confírmalo.`;
          enriquecida.campos[clave] = { ...actual!, notas: [...(actual!.notas ?? []), `El catálogo dice «${hallada.km}», el documento dice «${actual!.valor}». Confírmalo.`] };
          avisos.push({ tipo: 'diferencia_catalogo', campo: clave, renglon: null, mensaje: `Distancia (destino ${n}): ${msg} Se conservó lo del cliente.` });
        }
      }
      continue;
    }
    if (hallada.tipo === 'unica') {
      const v: CampoValor = {
        valor: String(hallada.km), confianza: 0.95, evidencia: 'Catálogo de distancias del cliente', origen: 'catalogo', notas: [NOTA_COMPLETADO],
      };
      enriquecida.campos[clave] = v;
      completados.push({ campo: clave, renglon: null, valor: v.valor as string, fuente: 'catalogo_distancias' });
    } else if (hallada.tipo === 'ambigua') {
      avisos.push({ tipo: 'ambiguo', campo: clave, renglon: null, mensaje: `Distancia (destino ${n}): el catálogo trae distancias distintas para este destino; no se aplicó ninguna.` });
    }
  }

  // ── 4. Lo que sigue faltando es bloqueo «falta dato» (nunca un valor inventado) ───────────────────────────────────
  const falta = (campo: string, renglon: number | null, mensaje: string): void => { faltantes.push({ campo, renglon, bloqueante: true, mensaje }); };
  for (const k of ['numero_cliente_interno', 'caja_numero']) {
    if (vacio(enriquecida.campos[k])) falta(k, null, `Falta ${rotulo(k)}: el cliente no lo trae y el catálogo no lo resuelve. Captúralo a mano.`);
  }
  for (let n = 1; n <= nDest; n++) {
    const clave = campoDestino('distancia_km', n);
    if (vacio(enriquecida.campos[clave])) falta(clave, null, `Falta la distancia${nDest > 1 ? ` del destino ${n}` : ''}: el cliente no la trae y no hay distancia en el catálogo. Captúrala a mano (solo números, en km).`);
  }
  if (String(enriquecida.campos.origen_pais?.valor ?? '').toUpperCase() === 'MEX') {
    for (const c of CLAVES_DOMICILIO) {
      const k = `origen_${c}`;
      if (vacio(enriquecida.campos[k])) falta(k, null, `Falta ${campoDoc(k)?.rotulo?.toLowerCase() ?? k} del remitente: el cliente no la trae y el catálogo no la resuelve.`);
    }
  }
  for (let n = 1; n <= nDest; n++) {
    if (String(enriquecida.campos[campoDestino('destino_pais', n)]?.valor ?? '').toUpperCase() !== 'MEX') continue;
    for (const c of CLAVES_DOMICILIO) {
      const k = campoDestino(`destino_${c}`, n);
      if (vacio(enriquecida.campos[k])) falta(k, null, `Falta ${c.replace('_', ' de ')} del destino${nDest > 1 ? ` ${n}` : ''}: el cliente no la trae y el catálogo no la resuelve.`);
    }
  }

  // ── 5. Coherencia con el régimen (Guía de llenado): embalaje, pedimento, tipo de materia… Solo avisos ─────────────
  const hallazgosGuia = validarReglasGuia(enriquecida, undefined);
  for (const h of hallazgosGuia) avisos.push({ tipo: 'guia', campo: h.campo, renglon: h.renglon, mensaje: h.mensaje });

  const conservados = Object.values(original.campos).filter(llenoCliente).length
    + original.mercancias.reduce((s, f) => s + Object.values(f).filter(llenoCliente).length, 0);

  return { extraccion: enriquecida, completados, avisos, faltantes, hallazgosGuia, conservados };
}
