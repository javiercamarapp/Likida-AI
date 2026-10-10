import {
  MAX_INSTRUCCIONES_POR_CONVENIO, MAX_TEXTO_INSTRUCCION, esCategoria, esLugar, esMomento, type Instruccion,
} from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// LA EDICIÓN EN PANTALLA DE UN CONVENIO — puro, sin I/O: de lo que escribió el jefe a lo que se guarda.
//
// El formulario manda texto; aquí se valida TODO antes de tocar la base (mismos topes que los CHECK de la 0580, para que
// el error llegue en palabras y no como un «la base rechazó algo»). Todo o nada: si algo está mal, no se guarda nada y se
// dicen TODOS los problemas de una vez. La tarifa y los requisitos de cobro NO se editan aquí (son dinero y siguen
// entrando por la importación con permiso de finanzas).
// ═══════════════════════════════════════════════════════════════════════════

export interface InstruccionEntrada { categoria: string; texto: string; momento: string; lugar: string }

export interface EntradaConvenio {
  /** Vacío = alta de un convenio nuevo. */
  convenioId: string;
  /** Solo en el alta: al editar, el cliente del convenio no cambia. */
  clienteId: string;
  nombre: string;
  origen: string;
  destino: string;
  sitioOrigenId: string;
  sitioDestinoId: string;
  vigenteDesde: string;
  vigenteHasta: string;
  notas: string;
  /** La versión que leyó el formulario (solo al editar): evita pisar el cambio de otra persona. */
  version: string;
  instrucciones: InstruccionEntrada[];
  /** Llevar la edición a los viajes en curso de este convenio. */
  llevarAViajes: boolean;
  /** …y volver a mandar el despacho a los operadores que ya lo habían recibido. */
  reenviar: boolean;
}

export interface DatosConvenio {
  convenioId: string | null;
  clienteId: string | null;
  nombre: string;
  origen: string | null;
  destino: string | null;
  sitioOrigenId: string | null;
  sitioDestinoId: string | null;
  vigenteDesde: string | null;
  vigenteHasta: string | null;
  notas: string | null;
  version: number | null;
  instrucciones: Instruccion[];
}

export type ResultadoValidacion = { ok: true; datos: DatosConvenio } | { ok: false; errores: string[] };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FECHA = /^(\d{4})-(\d{2})-(\d{2})$/;
export const MAX_NOMBRE = 120;
export const MAX_LUGAR = 160;
export const MAX_NOTAS = 1000;

const una = (t: string): string => t.replace(/\s+/g, ' ').trim();

function fechaValida(t: string): boolean {
  const m = FECHA.exec(t);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]);
}

export function validarEntradaConvenio(e: EntradaConvenio): ResultadoValidacion {
  const errores: string[] = [];
  const editando = e.convenioId.trim() !== '';
  const convenioId = e.convenioId.trim().toLowerCase();
  const clienteId = e.clienteId.trim().toLowerCase();

  if (editando && !UUID.test(convenioId)) errores.push('No reconozco el convenio que se está editando.');
  if (!editando && !UUID.test(clienteId)) errores.push('Elige el cliente del convenio.');

  const nombre = una(e.nombre);
  if (nombre === '') errores.push('Ponle nombre al convenio (por ejemplo, la ruta).');
  else if (nombre.length > MAX_NOMBRE) errores.push(`El nombre del convenio no puede pasar de ${MAX_NOMBRE} caracteres.`);

  const origen = una(e.origen);
  const destino = una(e.destino);
  if (origen.length > MAX_LUGAR) errores.push(`El origen no puede pasar de ${MAX_LUGAR} caracteres.`);
  if (destino.length > MAX_LUGAR) errores.push(`El destino no puede pasar de ${MAX_LUGAR} caracteres.`);

  const sitio = (valor: string, que: string): string | null => {
    const v = valor.trim().toLowerCase();
    if (v === '') return null;
    if (!UUID.test(v)) { errores.push(`No reconozco el sitio de ${que}.`); return null; }
    return v;
  };
  const sitioOrigenId = sitio(e.sitioOrigenId, 'origen');
  const sitioDestinoId = sitio(e.sitioDestinoId, 'destino');

  const desde = e.vigenteDesde.trim();
  const hasta = e.vigenteHasta.trim();
  if (desde !== '' && !fechaValida(desde)) errores.push('La fecha «vigente desde» no es válida (usa AAAA-MM-DD).');
  if (hasta !== '' && !fechaValida(hasta)) errores.push('La fecha «vigente hasta» no es válida (usa AAAA-MM-DD).');
  if (desde !== '' && hasta !== '' && fechaValida(desde) && fechaValida(hasta) && hasta < desde) errores.push('«Vigente hasta» no puede ser anterior a «vigente desde».');

  const notas = e.notas.trim();
  if (notas.length > MAX_NOTAS) errores.push(`Las notas no pueden pasar de ${MAX_NOTAS} caracteres.`);

  let version: number | null = null;
  if (editando) {
    const n = Number(e.version);
    if (!Number.isInteger(n) || n < 1) errores.push('Falta la versión del convenio: recarga la página y vuelve a intentarlo.');
    else version = n;
  }

  const instrucciones: Instruccion[] = [];
  const vistas = new Set<string>();
  // Una fila sin texto es una fila en blanco del formulario: no cuenta (y no es un error).
  const llenas = e.instrucciones.filter((i) => una(i.texto) !== '');
  if (llenas.length > MAX_INSTRUCCIONES_POR_CONVENIO) errores.push(`Un convenio admite hasta ${MAX_INSTRUCCIONES_POR_CONVENIO} instrucciones.`);
  llenas.forEach((i, n) => {
    const fila = `Instrucción ${n + 1}`;
    const texto = una(i.texto);
    if (!esCategoria(i.categoria)) { errores.push(`${fila}: elige un tema válido.`); return; }
    if (!esMomento(i.momento)) { errores.push(`${fila}: elige cuándo se manda.`); return; }
    if (!esLugar(i.lugar)) { errores.push(`${fila}: elige a qué planta aplica.`); return; }
    if (texto.length > MAX_TEXTO_INSTRUCCION) { errores.push(`${fila}: no puede pasar de ${MAX_TEXTO_INSTRUCCION} caracteres.`); return; }
    const llave = `${i.categoria}|${texto.toLowerCase()}`;
    if (vistas.has(llave)) { errores.push(`${fila}: está repetida (mismo tema y mismo texto).`); return; }
    vistas.add(llave);
    instrucciones.push({ categoria: i.categoria, texto, momento: i.momento, lugar: i.lugar, orden: n + 1 });
  });

  if (errores.length > 0) return { ok: false, errores };
  return {
    ok: true,
    datos: {
      convenioId: editando ? convenioId : null, clienteId: editando ? null : clienteId, nombre,
      origen: origen === '' ? null : origen, destino: destino === '' ? null : destino, sitioOrigenId, sitioDestinoId,
      vigenteDesde: desde === '' ? null : desde, vigenteHasta: hasta === '' ? null : hasta, notas: notas === '' ? null : notas,
      version, instrucciones,
    },
  };
}
