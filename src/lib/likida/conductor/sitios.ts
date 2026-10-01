import { coordenadasValidas, dentroDeMexico } from './geo';

// ═══════════════════════════════════════════════════════════════════════════
// EL CATÁLOGO DE SITIOS (clientes, plantas, andenes) — del CSV a filas validadas.
// Puro, sin I/O: la escritura es `importar_sitios_conductor` (0385), que revisa lo
// que solo la base sabe (que el cliente exista, que el padre exista) y escribe
// TODO O NADA.
//
// ── NO SE INVENTA NINGUNA COORDENADA ───────────────────────────────────────
// Una fila sin latitud o sin longitud es un ERROR, no una fila a medias que se
// geocodifica «por la dirección» (eso sería inventar un punto y validar viajes
// contra él). Tampoco se «arregla» una lat/lng intercambiada o con el signo
// perdido: se rechaza y se dice qué parece. El radio tampoco se supone: o viene
// en el archivo o lo declara quien importa (`radioPorDefectoM`), a la vista.
//
// Columnas (cabecera obligatoria, sin distinguir mayúsculas ni acentos):
//   codigo*  nombre*  tipo*  lat*  lng*  radio_m (o radio)  direccion  cliente  padre
// `tipo`: cliente | planta | anden | patio | punto_interes. `cliente`: nombre de un
// cliente ya existente. `padre`: código de otro sitio (un andén cuelga de su planta).
// Separador: coma, punto y coma o tabulador (se detecta). Con `;` el decimal puede
// ser coma (el CSV de Excel en español).
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_FILAS_SITIOS = 2000;
export const MAX_BYTES_CSV_SITIOS = 1_000_000;

export const TIPOS_SITIO = ['cliente', 'planta', 'anden', 'patio', 'punto_interes'] as const;
export type TipoSitio = typeof TIPOS_SITIO[number];

export interface SitioCsv {
  linea: number;
  codigo: string;
  nombre: string;
  tipo: TipoSitio;
  lat: number;
  lng: number;
  radio_m: number;
  direccion: string | null;
  cliente: string | null;
  padre: string | null;
}

export interface ErrorCsv {
  /** Número de línea del archivo (la cabecera es la 1). 0 = del archivo entero. */
  linea: number;
  mensaje: string;
}

export interface ResultadoCsv {
  filas: SitioCsv[];
  errores: ErrorCsv[];
}

const sinAcentos = (t: string): string => t.normalize('NFD').replace(/[̀-ͯ]/g, '');
const clave = (t: string): string => sinAcentos(t).toLowerCase().trim().replace(/[\s-]+/g, '_');

const ALIAS_COLUMNA: Record<string, string> = {
  codigo: 'codigo', code: 'codigo', clave: 'codigo',
  nombre: 'nombre', name: 'nombre', sitio: 'nombre',
  tipo: 'tipo',
  lat: 'lat', latitud: 'lat', latitude: 'lat',
  lng: 'lng', lon: 'lng', long: 'lng', longitud: 'lng', longitude: 'lng',
  radio_m: 'radio_m', radio: 'radio_m', radio_metros: 'radio_m',
  direccion: 'direccion', domicilio: 'direccion',
  cliente: 'cliente',
  padre: 'padre', sitio_padre: 'padre', planta: 'padre',
};

const ALIAS_TIPO: Record<string, TipoSitio> = {
  cliente: 'cliente', planta: 'planta', anden: 'anden', patio: 'patio', punto_interes: 'punto_interes', punto_de_interes: 'punto_interes',
};

/** Parte el texto en registros y campos respetando comillas (`""` = comilla). */
function partir(texto: string, sep: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; } else comillas = false;
      } else campo += c;
    } else if (c === '"' && campo === '') comillas = true;
    else if (c === sep) { fila.push(campo); campo = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo); campo = '';
      filas.push(fila); fila = [];
    } else campo += c;
  }
  if (campo !== '' || fila.length > 0) { fila.push(campo); filas.push(fila); }
  return filas;
}

function detectarSeparador(primeraLinea: string): string {
  const cuenta = (s: string) => primeraLinea.split(s).length - 1;
  const candidatos: Array<[string, number]> = [[',', cuenta(',')], [';', cuenta(';')], ['\t', cuenta('\t')]];
  candidatos.sort((a, b) => b[1] - a[1]);
  return candidatos[0][1] > 0 ? candidatos[0][0] : ',';
}

function numero(valor: string, decimalComa: boolean): number | null {
  let t = valor.trim();
  if (t === '') return null;
  if (decimalComa) t = t.replace(',', '.');
  // Solo dígitos, signo y un punto: nada de «20°43'» ni de notación científica.
  if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function parsearCsvSitios(texto: string, opciones: { radioPorDefectoM?: number | null } = {}): ResultadoCsv {
  const errores: ErrorCsv[] = [];
  if (typeof texto !== 'string' || texto.trim() === '') return { filas: [], errores: [{ linea: 0, mensaje: 'El archivo está vacío.' }] };
  if (texto.length > MAX_BYTES_CSV_SITIOS) {
    return { filas: [], errores: [{ linea: 0, mensaje: 'El archivo pesa más de 1 MB; divídelo en partes.' }] };
  }
  const limpio = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(limpio.split(/\r?\n/, 1)[0] ?? '');
  const decimalComa = sep === ';';
  const registros = partir(limpio, sep);
  const cabecera = (registros[0] ?? []).map((c) => ALIAS_COLUMNA[clave(c)] ?? `__${clave(c)}`);
  for (const obligatoria of ['codigo', 'nombre', 'tipo', 'lat', 'lng']) {
    if (!cabecera.includes(obligatoria)) {
      errores.push({ linea: 1, mensaje: `Falta la columna «${obligatoria}» en la cabecera.` });
    }
  }
  const radioPorDefecto = opciones.radioPorDefectoM ?? null;
  if (!cabecera.includes('radio_m') && radioPorDefecto === null) {
    errores.push({ linea: 1, mensaje: 'Falta la columna «radio_m»: pon el radio de cada sitio o indica un radio por defecto al importar.' });
  }
  if (errores.length > 0) return { filas: [], errores };

  const cuerpo = registros.slice(1).map((r, i) => ({ linea: i + 2, celdas: r })).filter((r) => r.celdas.some((c) => c.trim() !== ''));
  if (cuerpo.length === 0) return { filas: [], errores: [{ linea: 0, mensaje: 'El archivo no trae filas debajo de la cabecera.' }] };
  if (cuerpo.length > MAX_FILAS_SITIOS) {
    return { filas: [], errores: [{ linea: 0, mensaje: `El archivo trae ${cuerpo.length} filas; el máximo por importación es ${MAX_FILAS_SITIOS}.` }] };
  }

  const filas: SitioCsv[] = [];
  const codigos = new Map<string, number>();
  const nombres = new Map<string, number>();
  for (const { linea, celdas } of cuerpo) {
    const v: Record<string, string> = {};
    cabecera.forEach((col, i) => { if (!col.startsWith('__')) v[col] = (celdas[i] ?? '').trim(); });
    const falla = (mensaje: string) => errores.push({ linea, mensaje });

    const codigo = v.codigo ?? '';
    if (!codigo || codigo.length > 40) { falla('El código es obligatorio y de hasta 40 caracteres.'); continue; }
    const nombre = (v.nombre ?? '').replace(/\s+/g, ' ');
    if (!nombre || nombre.length > 120) { falla('El nombre es obligatorio y de hasta 120 caracteres.'); continue; }
    const tipo = ALIAS_TIPO[clave(v.tipo ?? '')];
    if (!tipo) { falla(`El tipo «${v.tipo}» no es válido. Usa: ${TIPOS_SITIO.join(', ')}.`); continue; }

    const lat = numero(v.lat ?? '', decimalComa);
    const lng = numero(v.lng ?? '', decimalComa);
    if (lat === null || lng === null) {
      falla('Faltan coordenadas válidas (lat y lng en grados decimales, p. ej. 20.7200 y -103.3900). No se calculan a partir de la dirección.');
      continue;
    }
    // Primero lo que PARECE intercambiado (con la latitud fuera de rango o dentro de él): es el error humano más común.
    if (coordenadasValidas(lng, lat) && dentroDeMexico(lng, lat)) {
      falla('La latitud y la longitud parecen ir intercambiadas (la latitud de México es ~14 a 33, la longitud ~-118 a -86).');
      continue;
    }
    if (!coordenadasValidas(lat, lng)) { falla('Las coordenadas están fuera del rango geográfico.'); continue; }
    if (!dentroDeMexico(lat, lng)) {
      falla('Las coordenadas caen fuera de México: revisa el signo de la longitud (en México es negativa).');
      continue;
    }

    let radio: number | null;
    if (cabecera.includes('radio_m') && (v.radio_m ?? '') !== '') {
      radio = numero(v.radio_m, decimalComa);
      if (radio === null || !Number.isInteger(radio)) { falla('El radio tiene que ser un número entero de metros.'); continue; }
    } else radio = radioPorDefecto;
    if (radio === null) { falla('Falta el radio de este sitio.'); continue; }
    if (radio < 25 || radio > 100_000) { falla('El radio tiene que estar entre 25 y 100,000 metros (por debajo de 25 m el GPS civil entra y sale solo).'); continue; }

    const direccion = v.direccion ? v.direccion.replace(/\s+/g, ' ').slice(0, 200) : null;
    const cliente = v.cliente ? v.cliente.replace(/\s+/g, ' ') : null;
    const padre = v.padre || null;
    if (padre && padre === codigo) { falla('Un sitio no puede ser su propio padre.'); continue; }

    const previoCodigo = codigos.get(codigo.toLowerCase());
    if (previoCodigo !== undefined) { falla(`El código «${codigo}» ya aparece en la línea ${previoCodigo}.`); continue; }
    const previoNombre = nombres.get(nombre.toLowerCase());
    if (previoNombre !== undefined) { falla(`El nombre «${nombre}» ya aparece en la línea ${previoNombre}.`); continue; }
    codigos.set(codigo.toLowerCase(), linea);
    nombres.set(nombre.toLowerCase(), linea);

    filas.push({ linea, codigo, nombre, tipo, lat, lng, radio_m: radio, direccion, cliente, padre });
  }

  // Ciclos de padres dentro del archivo (A→B→A): la jerarquía es un árbol.
  const padreDe = new Map(filas.map((f) => [f.codigo, f.padre]));
  for (const f of filas) {
    let actual: string | null = f.padre;
    const visto = new Set<string>([f.codigo]);
    while (actual && padreDe.has(actual)) {
      if (visto.has(actual)) { errores.push({ linea: f.linea, mensaje: `El sitio «${f.codigo}» forma un ciclo de padres.` }); break; }
      visto.add(actual);
      actual = padreDe.get(actual) ?? null;
    }
  }
  errores.sort((a, b) => a.linea - b.linea);
  return { filas, errores };
}

/** La plantilla que se descarga del panel: cabecera + dos filas de EJEMPLO con coordenadas ficticias marcadas como tales. */
export const PLANTILLA_CSV_SITIOS =
  'codigo,nombre,tipo,lat,lng,radio_m,direccion,cliente,padre\n'
  + 'EJEMPLO-PL1,REEMPLAZA: nombre de la planta,planta,,,300,REEMPLAZA: dirección,,\n'
  + 'EJEMPLO-AN1,REEMPLAZA: nombre del andén,anden,,,60,,,EJEMPLO-PL1\n';

// ── La captura manual (el editor del panel) ─────────────────────────────────

export interface SitioManual {
  id?: string;
  nombre: string;
  tipo: TipoSitio;
  codigo: string | null;
  direccion: string | null;
  lat: number;
  lng: number;
  radioM: number;
  clienteId: string | null;
  padreId: string | null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Lee el formulario del editor de sitios con las MISMAS reglas que el CSV: ni una coordenada se calcula, se adivina o se
 * «arregla». Acepta coma decimal (el teclado en español) solo cuando es inequívoca: un campo con UNA coma y ningún punto.
 */
export function leerSitioManual(fd: { get(k: string): unknown }): { ok: SitioManual } | { error: string } {
  const txt = (k: string): string => (typeof fd.get(k) === 'string' ? (fd.get(k) as string).trim() : '');
  const nombre = txt('nombre').replace(/\s+/g, ' ');
  if (!nombre || nombre.length > 120) return { error: 'El nombre es obligatorio y de hasta 120 caracteres.' };
  const tipo = ALIAS_TIPO[clave(txt('tipo'))];
  if (!tipo) return { error: `Elige el tipo de sitio: ${TIPOS_SITIO.join(', ')}.` };
  const codigo = txt('codigo');
  if (codigo.length > 40) return { error: 'El código admite hasta 40 caracteres.' };
  const direccion = txt('direccion').replace(/\s+/g, ' ');
  if (direccion.length > 200) return { error: 'La dirección admite hasta 200 caracteres.' };

  const decimal = (k: string): number | null => {
    let t = txt(k);
    if (/^-?\d+,\d+$/.test(t)) t = t.replace(',', '.');
    return numero(t, false);
  };
  const lat = decimal('lat');
  const lng = decimal('lng');
  if (lat === null || lng === null) return { error: 'Escribe la latitud y la longitud en grados decimales (p. ej. 20.7200 y -103.3900). No se calculan a partir de la dirección.' };
  if (coordenadasValidas(lng, lat) && dentroDeMexico(lng, lat)) return { error: 'La latitud y la longitud parecen ir intercambiadas.' };
  if (!coordenadasValidas(lat, lng)) return { error: 'Las coordenadas están fuera del rango geográfico.' };
  if (!dentroDeMexico(lat, lng)) return { error: 'Las coordenadas caen fuera de México: revisa el signo de la longitud (en México es negativa).' };

  const radioTxt = txt('radio_m');
  const radio = /^\d+$/.test(radioTxt) ? Number(radioTxt) : null;
  if (radio === null || radio < 25 || radio > 100_000) return { error: 'El radio va de 25 a 100,000 metros (por debajo de 25 m el GPS civil entra y sale solo).' };

  const id = txt('id');
  if (id && !UUID.test(id)) return { error: 'No reconozco el sitio que intentas editar.' };
  const clienteId = txt('cliente_id');
  const padreId = txt('padre_id');
  if (clienteId && !UUID.test(clienteId)) return { error: 'No reconozco el cliente elegido.' };
  if (padreId && !UUID.test(padreId)) return { error: 'No reconozco el sitio padre elegido.' };
  if (id && padreId && id.toLowerCase() === padreId.toLowerCase()) return { error: 'Un sitio no puede ser su propio padre.' };
  return {
    ok: {
      ...(id ? { id: id.toLowerCase() } : {}), nombre, tipo, codigo: codigo || null, direccion: direccion || null, lat, lng, radioM: radio,
      clienteId: clienteId ? clienteId.toLowerCase() : null, padreId: padreId ? padreId.toLowerCase() : null,
    },
  };
}
