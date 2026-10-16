// ═══════════════════════════════════════════════════════════════════════════
// CATÁLOGO DE DISTANCIAS origen→destino POR CLIENTE (T-A3-51, migración 0830).
//
// La distancia («solo números», constante por ruta) no viene en ningún documento del cliente: antes se le pedía al
// modelo, que la inventaba. Ahora la flota carga una tabla de rutas por cliente y aquí se resuelve el par conocido:
//
//   · Par conocido → la distancia sale del catálogo (origen `catalogo`, marcada «completado»).
//   · Par desconocido (o dos distancias distintas para el mismo par) → bloqueo `distancia_faltante`: jamás se adivina.
//   · El formato se normaliza: «812,35 km» → «812.35». El libro del TMS recibe solo el número.
//
// Una ruta es DIRIGIDA (origen→destino; la vuelta es otra fila). Se busca primero por par de códigos postales y, si no
// hay, por par de municipios; si el CP da un par único gana sobre el municipio (es la clave más específica).
//
// Reglas de siempre: nunca pisa un valor `humano`; un valor que el documento trae distinto al catálogo se conserva y
// queda una nota «Confírmalo»; solo se usan filas del mismo tenant y cliente (defensa en profundidad).
// Todo es PURO salvo el puerto de la importación CSV (lo recibe quien llama).
// ═══════════════════════════════════════════════════════════════════════════

import { numero } from '@/lib/formato';
import { campoDoc, type CampoValor, type Extraccion } from './campos';
import { CONTROL, INICIO_FORMULA, TAMANO_LOTE, TOPE_BYTES_IMPORTACION, TOPE_ERRORES_VISIBLES, TOPE_FILAS_IMPORTACION, UUID, enLotes, leerCsv, normEncabezado, type ErrorFila, type ResultadoImportacion } from './catalogo_import';
import type { ContextoCatalogo } from './catalogo_cliente';
import { llaveTexto } from './catalogos';
import { normalizarNumero } from './normalizar';
import { campoDestino, MAX_DESTINOS } from './plantilla_tms';
import type { Hallazgo } from './validacion';

export type TipoRuta = 'cp' | 'municipio';

/** Una fila del catálogo (`cp_distancia`). `origen` y `destino` ya vienen en forma canónica (CP de 5 dígitos o municipio normalizado). */
export interface RutaDistancia {
  tenantId: string;
  clienteId: string;
  tipo: TipoRuta;
  origen: string;
  destino: string;
  km: number;
}

export const KM_MAXIMO = 99_999.99;
export const CONFIANZA_DISTANCIA = 0.95;
export const NOTA_DISTANCIA_CATALOGO = 'Completado: la distancia salió del catálogo de distancias del cliente; el documento no la trae.';

// ── Formato ─────────────────────────────────────────────────────────────────

export type LecturaKm = { ok: true; km: number; texto: string } | { ok: false; motivo: 'vacia' | 'ilegible' | 'ambigua' | 'fuera_de_rango' };

/** `812.35`, `920`, `1250.5`: el número sin ceros de sobra y con punto decimal. */
export const textoKm = (km: number): string => String(Math.round(km * 100) / 100);

/**
 * «812,35 km», «1,250.50 km», «920» → número. «1.500» / «1,500» es ambiguo (¿uno punto cinco o mil quinientos?) y NO
 * se adivina; cero, negativo, más de 99 999.99 o texto que no es número tampoco.
 */
export function leerKm(crudo: string | number | null | undefined): LecturaKm {
  const t = String(crudo ?? '').trim().replace(/\s*(?:km|kms|kil[oó]metros?)\.?$/i, '').trim(); // «812km» y «812 km»
  if (t === '') return { ok: false, motivo: 'vacia' };
  const n = normalizarNumero(t);
  if (n.valor === null) return { ok: false, motivo: 'ilegible' };
  if (n.ambiguo) return { ok: false, motivo: 'ambigua' };
  const km = Math.round(n.valor * 100) / 100;
  if (!(km > 0) || km > KM_MAXIMO) return { ok: false, motivo: 'fuera_de_rango' };
  return { ok: true, km, texto: textoKm(km) };
}

/** Forma canónica con la que se guarda y se busca un lugar: CP de 5 dígitos, o municipio sin acentos ni mayúsculas. */
export const claveMunicipio = (m: string | null | undefined): string => llaveTexto(m ?? '').replace(/\s+/g, ' ');
export const claveCp = (cp: string | null | undefined): string | null => {
  const t = (cp ?? '').trim();
  return /^[0-9]{5}$/.test(t) ? t : null;
};

// ── Resolver el par ─────────────────────────────────────────────────────────

export interface LugarRuta { cp?: string | null; municipio?: string | null }

export type ResolucionDistancia =
  | { tipo: 'unica'; km: number; por: TipoRuta }
  | { tipo: 'ambigua'; por: TipoRuta }
  | { tipo: 'ninguna' };

function buscarPar(propias: readonly RutaDistancia[], tipo: TipoRuta, origen: string | null, destino: string | null): ResolucionDistancia {
  if (!origen || !destino) return { tipo: 'ninguna' };
  const hallados = propias.filter((r) => r.tipo === tipo && r.origen === origen && r.destino === destino && Number.isFinite(r.km) && r.km > 0);
  if (hallados.length === 0) return { tipo: 'ninguna' };
  const kms = new Set(hallados.map((r) => Math.round(r.km * 100)));
  if (kms.size > 1) return { tipo: 'ambigua', por: tipo };
  return { tipo: 'unica', km: hallados[0].km, por: tipo };
}

/** Par conocido → su distancia; el par se busca solo entre las rutas del mismo tenant y cliente. Nunca devuelve una conjetura. */
export function resolverDistancia(
  rutas: readonly RutaDistancia[] | null | undefined, ctx: ContextoCatalogo, origen: LugarRuta, destino: LugarRuta,
): ResolucionDistancia {
  if (!ctx.clienteId || !rutas || rutas.length === 0) return { tipo: 'ninguna' };
  const propias = rutas.filter((r) => r.tenantId === ctx.tenantId && r.clienteId === ctx.clienteId);
  const porCp = buscarPar(propias, 'cp', claveCp(origen.cp), claveCp(destino.cp));
  if (porCp.tipo !== 'ninguna') return porCp;
  const mo = claveMunicipio(origen.municipio); const md = claveMunicipio(destino.municipio);
  return buscarPar(propias, 'municipio', mo === '' ? null : mo, md === '' ? null : md);
}

// ── Completar la extracción ─────────────────────────────────────────────────

export interface ResultadoDistancias {
  extraccion: Extraccion;
  /** Claves de `campos` que el catálogo llenó. */
  completados: string[];
  /** `distancia_faltante` (bloqueo), `distancia_ilegible` y avisos de diferencia (confirmar). */
  hallazgos: Hallazgo[];
}

const vacio = (c: CampoValor | undefined): boolean => !c || c.valor === null || String(c.valor).trim() === '';

function numeroDestinos(e: Extraccion): number {
  let max = 1;
  for (const [k, v] of Object.entries(e.campos)) {
    const m = /^destino_(\d+)_/.exec(k);
    if (m && !vacio(v)) max = Math.max(max, Number(m[1]));
  }
  return Math.min(max, MAX_DESTINOS);
}

const texto = (c: CampoValor | undefined): string | null => (vacio(c) ? null : String(c!.valor).trim());

/**
 * La distancia de cada destino (1..4) desde el origen del documento. Devuelve una extracción NUEVA.
 *   · Vacía y par conocido → el catálogo la llena.
 *   · Vacía y par desconocido/ambiguo → bloqueo `distancia_faltante` (capturar a mano en el visor).
 *   · Con valor del documento → solo se normaliza el formato («812,35 km» → «812.35»); si el catálogo discrepa se
 *     conserva el valor del documento con una nota «Confírmalo»; si no se puede leer, `distancia_ilegible` (bloqueo).
 *   · Un valor `humano` nunca se toca.
 */
export function completarDistancias(
  entrada: Extraccion, rutas: readonly RutaDistancia[] | null | undefined, ctx: ContextoCatalogo,
): ResultadoDistancias {
  const salida: Extraccion = structuredClone(entrada);
  const completados: string[] = [];
  const hallazgos: Hallazgo[] = [];
  const nDest = numeroDestinos(salida);
  const origen: LugarRuta = { cp: texto(salida.campos.origen_cp), municipio: texto(salida.campos.origen_municipio) };

  for (let n = 1; n <= nDest; n++) {
    const clave = campoDestino('distancia_km', n);
    const donde = nDest > 1 ? ` del destino ${n}` : '';
    const destino: LugarRuta = {
      cp: texto(salida.campos[campoDestino('destino_cp', n)]), municipio: texto(salida.campos[campoDestino('destino_municipio', n)]),
    };
    const res = resolverDistancia(rutas, ctx, origen, destino);
    const actual = salida.campos[clave];

    if (!vacio(actual)) {
      if (actual!.origen === 'humano') continue;
      const lectura = leerKm(actual!.valor);
      if (!lectura.ok) {
        hallazgos.push({
          campo: clave, renglon: null, severidad: 'bloqueo', codigo: 'distancia_ilegible',
          mensaje: `La distancia${donde} («${actual!.valor}») no se puede leer como número de km${lectura.motivo === 'ambigua' ? ' (el separador es ambiguo)' : ''}. Captúrala a mano (solo números).`,
        });
        continue;
      }
      salida.campos[clave] = { ...actual!, valor: lectura.texto }; // «812,35 km» → «812.35»
      if (res.tipo === 'unica' && Math.abs(res.km - lectura.km) > 0.5) {
        salida.campos[clave].notas = [...(actual!.notas ?? []), `El catálogo dice «${textoKm(res.km)}», el documento dice «${lectura.texto}». Confírmalo.`];
        hallazgos.push({
          campo: clave, renglon: null, severidad: 'confirmar', codigo: 'distancia_difiere_catalogo',
          mensaje: `La distancia${donde} del catálogo es ${textoKm(res.km)} km y el documento dice ${lectura.texto} km. Se conservó lo del documento: confírmalo.`,
        });
      }
      continue;
    }

    if (res.tipo === 'unica') {
      salida.campos[clave] = {
        valor: textoKm(res.km), confianza: CONFIANZA_DISTANCIA, evidencia: `Catálogo de distancias del cliente (${res.por === 'cp' ? 'por código postal' : 'por municipio'})`,
        origen: 'catalogo', notas: [NOTA_DISTANCIA_CATALOGO],
      };
      completados.push(clave);
      continue;
    }
    hallazgos.push({
      campo: clave, renglon: null, severidad: 'bloqueo', codigo: 'distancia_faltante',
      mensaje: res.tipo === 'ambigua'
        ? `Falta la distancia${donde}: el catálogo trae distancias distintas para este par origen→destino y no se aplicó ninguna. Captúrala a mano (solo números, en km) y corrige el catálogo.`
        : `Falta la distancia${donde}: ese par origen→destino no está en el catálogo de distancias del cliente. Captúrala a mano (solo números, en km) o agrégalo al catálogo.`,
    });
  }
  return { extraccion: salida, completados, hallazgos };
}

/** Rótulo de la distancia (para el visor y la exportación). */
export const ROTULO_DISTANCIA = campoDoc('distancia_km')?.rotulo ?? 'Distancia (km)';

// ── Importación CSV (misma mecánica que T-A3-21) ────────────────────────────

export const COLUMNAS_DISTANCIA = ['cliente', 'tipo', 'origen', 'destino', 'km'] as const;
export const TABLA_DISTANCIA = 'cp_distancia';
export const CONFLICTO_DISTANCIA = 'tenant_id,cliente_id,tipo,origen,destino';

/** Registro canónico (snake_case, sin tenant): `km` va como texto con punto decimal, igual que lo valida `leerKm`. */
export interface RegistroDistancia { cliente_id: string; tipo: TipoRuta; origen: string; destino: string; km: string }

/** Lo único que la importación necesita de la base. Siempre acotado al tenant que se le pasa. */
export interface PuertoDistancias {
  clientes(tenantId: string): Promise<Array<{ id: string; nombre: string }>>;
  existentes(tenantId: string, clienteIds: string[]): Promise<RegistroDistancia[]>;
  aplicarLote(tenantId: string, registros: RegistroDistancia[], actorId: string): Promise<void>;
}

const EJEMPLO = ['Cliente de ejemplo', 'cp', '00000', '00001', '100'];
const celdaCsv = (v: string): string => (/[",;\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

/** El CSV vacío: encabezado + UNA fila sintética (su cliente no existe: hay que cambiarla). */
export function plantillaDistanciasCsv(): string {
  return `﻿${COLUMNAS_DISTANCIA.join(',')}\r\n${EJEMPLO.map(celdaCsv).join(',')}\r\n`;
}

export const claveDeRuta = (r: Pick<RegistroDistancia, 'cliente_id' | 'tipo' | 'origen' | 'destino'>): string =>
  [r.cliente_id, r.tipo, r.origen, r.destino].join('|');

export type ValidacionDistancias =
  | { ok: false; mensaje: string }
  | { ok: true; validas: Array<{ fila: number; registro: RegistroDistancia }>; errores: ErrorFila[]; total: number };

export function validarFilasDistancia(filas: string[][], clientes: ReadonlyArray<{ id: string; nombre: string }>): ValidacionDistancias {
  if (filas.length === 0) return { ok: false, mensaje: 'El archivo está vacío.' };
  const esperadas: readonly string[] = COLUMNAS_DISTANCIA;
  const cab = filas[0].map(normEncabezado);
  const desconocidas = cab.filter((h) => !esperadas.includes(h));
  if (desconocidas.length > 0) {
    return { ok: false, mensaje: `Columna no reconocida: ${desconocidas.map((h) => `«${h || '(sin nombre)'}»`).join(', ')}. Descarga la plantilla y usa sus columnas.` };
  }
  const repetidas = cab.filter((h, i) => cab.indexOf(h) !== i);
  if (repetidas.length > 0) return { ok: false, mensaje: `La columna «${repetidas[0]}» está repetida.` };
  const faltan = COLUMNAS_DISTANCIA.filter((h) => !cab.includes(h));
  if (faltan.length > 0) return { ok: false, mensaje: `Falta la columna obligatoria ${faltan.map((h) => `«${h}»`).join(', ')}.` };
  const datos = filas.slice(1);
  if (datos.length === 0) return { ok: false, mensaje: 'El archivo solo trae el encabezado: no hay filas que importar.' };
  if (datos.length > TOPE_FILAS_IMPORTACION) {
    return { ok: false, mensaje: `El archivo trae más de ${numero(TOPE_FILAS_IMPORTACION)} filas. Pártelo en varios.` };
  }

  const porId = new Map(clientes.map((c) => [c.id.toLowerCase(), c.id]));
  const porNombre = new Map<string, string[]>();
  for (const c of clientes) porNombre.set(llaveTexto(c.nombre), [...(porNombre.get(llaveTexto(c.nombre)) ?? []), c.id]);

  const validas: Array<{ fila: number; registro: RegistroDistancia }> = [];
  const errores: ErrorFila[] = [];
  const vistas = new Map<string, number>();
  const idx = (clave: string): number => cab.indexOf(clave);

  datos.forEach((celdas, i) => {
    const fila = i + 2; // la fila 1 es el encabezado, como en la hoja de cálculo
    const problemas: string[] = [];
    const leer = (clave: string): string => (celdas[idx(clave)] ?? '').trim();

    for (let k = 0; k < cab.length; k++) {
      const cruda = celdas[k] ?? '';
      const v = cruda.trim();
      if (v === '') continue;
      if (INICIO_FORMULA.test(cruda) || INICIO_FORMULA.test(v)) {
        const primero = /^[\t\r]/.test(cruda) ? 'un tabulador' : `«${v[0]}»`;
        problemas.push(`«${cab[k]}» empieza con ${primero}, que una hoja de cálculo toma como fórmula. Quita ese carácter.`);
      } else if (CONTROL.test(v)) problemas.push(`«${cab[k]}» trae caracteres que no son texto.`);
    }

    let clienteId: string | null = null;
    const ref = leer('cliente');
    if (ref === '') problemas.push('Falta el cliente.');
    else if (UUID.test(ref)) {
      clienteId = porId.get(ref.toLowerCase()) ?? null;
      if (!clienteId) problemas.push('Ese cliente no es de tu flota.');
    } else {
      const ids = porNombre.get(llaveTexto(ref)) ?? [];
      if (ids.length === 1) clienteId = ids[0];
      else if (ids.length > 1) problemas.push(`Hay ${ids.length} clientes llamados «${ref}»: usa su id en lugar del nombre.`);
      else problemas.push(`No hay un cliente llamado «${ref}» en tu flota.`);
    }

    const tipoCrudo = llaveTexto(leer('tipo'));
    const tipo: TipoRuta | null = tipoCrudo === 'cp' || tipoCrudo === 'municipio' ? tipoCrudo : null;
    if (!tipo) problemas.push(`«tipo» debe ser cp o municipio (dice «${leer('tipo')}»).`);

    let origen = ''; let destino = '';
    for (const col of ['origen', 'destino'] as const) {
      const crudo = leer(col);
      let valor = '';
      if (tipo === 'cp') {
        if (/^[0-9]{5}$/.test(crudo)) valor = crudo;
        else problemas.push(`«${col}» debe ser un código postal de 5 dígitos (dice «${crudo}»). Si Excel le quitó el cero inicial, escribe la columna como texto.`);
      } else if (tipo === 'municipio') {
        valor = claveMunicipio(crudo);
        if (valor === '') problemas.push(`Falta «${col}».`);
        else if (valor.length > 120) { problemas.push(`«${col}» pasa de 120 caracteres.`); valor = ''; }
      }
      if (col === 'origen') origen = valor; else destino = valor;
    }

    const lectura = leerKm(leer('km'));
    let km = '';
    if (lectura.ok) km = lectura.texto;
    else {
      const t = leer('km');
      problemas.push(
        lectura.motivo === 'vacia' ? 'Falta «km».'
          : lectura.motivo === 'ambigua' ? `«km» es ambiguo (dice «${t}»): escribe el número con punto decimal y sin separador de miles.`
            : lectura.motivo === 'fuera_de_rango' ? `«km» debe ser mayor que 0 y de ${numero(KM_MAXIMO)} como máximo (dice «${t}»).`
              : `«km» no es un número (dice «${t}»).`,
      );
    }

    if (problemas.length === 0 && clienteId && tipo) {
      const registro: RegistroDistancia = { cliente_id: clienteId, tipo, origen, destino, km };
      const clave = claveDeRuta(registro);
      const previa = vistas.get(clave);
      if (previa !== undefined) problemas.push(`Repite la ruta de la fila ${previa}.`);
      else { vistas.set(clave, fila); validas.push({ fila, registro }); return; }
    }
    errores.push({ fila, mensaje: problemas.join(' ') });
  });
  return { ok: true, validas, errores, total: datos.length };
}

export interface EntradaImportacionDistancias { tenantId: string; actorId: string; bytes: Uint8Array; /** `false` = vista previa. */ confirmar: boolean }

const vacioRes = (mensaje: string): ResultadoImportacion => ({ ok: false, aplicado: false, mensaje, nuevas: 0, cambian: 0, sinCambio: 0, conError: 0, errores: [] });
const plural = (n: number, uno: string, varios: string): string => `${n} ${n === 1 ? uno : varios}`;

export async function importarDistancias(e: EntradaImportacionDistancias, puerto: PuertoDistancias): Promise<ResultadoImportacion> {
  if (e.bytes.byteLength > TOPE_BYTES_IMPORTACION) return vacioRes(`El archivo pesa más de ${TOPE_BYTES_IMPORTACION / 1024 / 1024} MB. Pártelo en varios.`);
  const lectura = leerCsv(e.bytes);
  if (!lectura.ok) return vacioRes(lectura.mensaje);
  const clientes = await puerto.clientes(e.tenantId);
  const v = validarFilasDistancia(lectura.filas, clientes);
  if (!v.ok) return vacioRes(v.mensaje);

  const ids = [...new Set(v.validas.map((x) => x.registro.cliente_id))];
  const existentes = ids.length > 0 ? await puerto.existentes(e.tenantId, ids) : [];
  const previo = new Map(existentes.map((x) => [claveDeRuta(x), Math.round(Number(x.km) * 100)]));
  const nuevas: RegistroDistancia[] = []; const cambian: RegistroDistancia[] = []; let sinCambio = 0;
  for (const { registro } of v.validas) {
    const antes = previo.get(claveDeRuta(registro));
    if (antes === undefined) nuevas.push(registro);
    else if (antes === Math.round(Number(registro.km) * 100)) sinCambio++;
    else cambian.push(registro);
  }
  const base = { nuevas: nuevas.length, cambian: cambian.length, sinCambio, conError: v.errores.length, errores: v.errores.slice(0, TOPE_ERRORES_VISIBLES) };
  const resumen = `${plural(base.nuevas, 'nueva', 'nuevas')}, ${base.cambian} ${base.cambian === 1 ? 'cambia' : 'cambian'}, ${plural(base.conError, 'fila con error', 'filas con error')}`;

  if (!e.confirmar) {
    return {
      ok: true, aplicado: false, ...base,
      mensaje: `Vista previa: ${resumen}${sinCambio > 0 ? ` (${sinCambio} sin cambio)` : ''}. ${base.conError > 0 ? 'Corrige las filas con error y vuelve a subir el archivo para poder aplicarlo.' : 'Nada se ha guardado todavía: confirma para aplicarlo.'}`,
    };
  }
  if (base.conError > 0) return { ok: false, aplicado: false, ...base, mensaje: `No se aplicó nada: ${resumen}. Corrige esas filas y vuelve a subir el archivo.` };
  const aEscribir = [...nuevas, ...cambian];
  if (aEscribir.length === 0) return { ok: true, aplicado: false, ...base, mensaje: `Nada que cambiar: el catálogo ya tiene estas ${plural(sinCambio, 'ruta', 'rutas')}.` };
  const lotes = enLotes(aEscribir, TAMANO_LOTE);
  let hechos = 0;
  for (let i = 0; i < lotes.length; i++) {
    try {
      await puerto.aplicarLote(e.tenantId, lotes[i], e.actorId);
      hechos += lotes[i].length;
    } catch {
      return { ok: false, aplicado: false, ...base, mensaje: `Se guardaron ${hechos} de ${aEscribir.length} rutas y el lote ${i + 1} de ${lotes.length} falló. Vuelve a subir el mismo archivo: lo ya guardado no se duplica.` };
    }
  }
  return { ok: true, aplicado: true, ...base, mensaje: `Listo: ${plural(base.nuevas, 'nueva', 'nuevas')} y ${base.cambian} ${base.cambian === 1 ? 'actualizada' : 'actualizadas'}.` };
}
