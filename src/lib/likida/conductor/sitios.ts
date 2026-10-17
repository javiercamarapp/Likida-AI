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
  /** 0630: polígono nativo del cliente (lat/lng/radio_m son el círculo que lo CONTIENE). Solo lo trae el importador de su tabla; el CSV del panel es círculo. */
  poligono?: Array<{ lat: number; lng: number }> | null;
  /** 0630: el círculo SUSTITUYE a un polígono que no se pudo guardar (la decisión con él es menos fiable). Nunca junto con `poligono`. */
  aproximada?: boolean;
  /** 0630: la re-importación automática no reactiva un sitio que la flota archivó. */
  conservar_activa?: boolean;
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
  if (!/^-?\d+$/.test(t) && !/^-?\d+\.\d+$/.test(t)) return null;
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

// ═══════════════════════════════════════════════════════════════════════════
// LAS EQUIVALENCIAS TEXTO→SITIO (0803) — el importador y la lista de «textos sin sitio» (T-A5-17).
//
// El origen y el destino de un viaje llegan como TEXTO LIBRE («STOP <planta> FINAL <producto>», «VACIO <cliente>»). Esta
// herramienta es NEUTRAL: no trae ningún diccionario; la flota (o su cliente) lo llena. Dos caminos:
//   · descargar los textos que hoy se quedan sin sitio, completarlos y subir el archivo;
//   · asignarlos uno a uno desde la pantalla.
// Todo puro, sin I/O: la lectura y la escritura son de `repo_validacion.ts`.
//
// Columnas del CSV (cabecera obligatoria, sin distinguir mayúsculas ni acentos):
//   texto*  geocerca_codigo  tipo  lado
//   · `tipo`: sitio | sin_sitio (alias «instruccion») | ignorar. Vacío con `geocerca_codigo` = sitio.
//   · `lado`: origen | destino | ambos (vacío = ambos).
//   · una fila con `tipo` y `geocerca_codigo` AMBOS vacíos es «sin completar» (la plantilla descargada): se omite, no es error.
// A diferencia del catálogo de sitios, aquí NO es todo-o-nada: una fila mala no tumba las demás, y se dice cuál y por qué.
// ═══════════════════════════════════════════════════════════════════════════

export const MAX_FILAS_EQUIVALENCIAS = 2000;
export const MAX_LARGO_TEXTO_EQUIVALENCIA = 200;
/** Cuántos textos sin sitio se listan (los más frecuentes). */
export const TOP_TEXTOS_SIN_SITIO = 50;
/** La ventana de viajes que se mira para la lista. */
export const DIAS_TEXTOS_SIN_SITIO = 14;

/** El valor del `<select>` de la lista que significa «esto es una instrucción, no un lugar» (tipo `sin_sitio`). */
export const MARCAR_INSTRUCCION = '__sin_sitio';
/** El valor del `<select>` de la lista que significa «ignora este texto» (tipo `ignorar`). */
export const MARCAR_IGNORAR = '__ignorar';

export const TIPOS_EQUIVALENCIA = ['sitio', 'sin_sitio', 'ignorar'] as const;
export type TipoEquivalencia = typeof TIPOS_EQUIVALENCIA[number];
export const LADOS_EQUIVALENCIA = ['origen', 'destino', 'ambos'] as const;
export type LadoEquivalencia = typeof LADOS_EQUIVALENCIA[number];

/**
 * Minúsculas, sin acentos, sin puntuación y con espacios simples. Es la MISMA función que `normalizarNombre` de
 * `sitio_derivado.ts` (la que compara `derivarSitio`); se repite aquí para que los formularios del navegador no arrastren
 * ese módulo, y una prueba vigila que no se separen.
 */
export function normalizarTextoEquivalencia(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

export interface EquivalenciaCsv {
  linea: number;
  /** Como vino en el archivo (espacios simples). */
  texto: string;
  textoNormalizado: string;
  /** Solo con `tipo === 'sitio'`: el código del sitio en el catálogo. */
  geocercaCodigo: string | null;
  tipo: TipoEquivalencia;
  lado: LadoEquivalencia;
}

export interface ResultadoCsvEquivalencias {
  filas: EquivalenciaCsv[];
  errores: ErrorCsv[];
  /** Filas de la plantilla que el cliente aún no completó (sin tipo ni sitio): se omiten sin ruido. */
  sinCompletar: number;
}

const ALIAS_COLUMNA_EQ: Record<string, string> = {
  texto: 'texto', texto_libre: 'texto', consignatario: 'texto', destinatario: 'texto',
  geocerca_codigo: 'geocerca_codigo', codigo_sitio: 'geocerca_codigo', codigo_geocerca: 'geocerca_codigo', sitio_codigo: 'geocerca_codigo', geocerca: 'geocerca_codigo', codigo: 'geocerca_codigo',
  tipo: 'tipo',
  lado: 'lado',
};
const ALIAS_TIPO_EQ: Record<string, TipoEquivalencia> = {
  sitio: 'sitio', sin_sitio: 'sin_sitio', instruccion: 'sin_sitio', ignorar: 'ignorar',
};
const ALIAS_LADO_EQ: Record<string, LadoEquivalencia> = {
  origen: 'origen', carga: 'origen', destino: 'destino', descarga: 'destino', ambos: 'ambos', ambas: 'ambos',
};

export function parsearCsvEquivalencias(texto: string): ResultadoCsvEquivalencias {
  const fallo = (linea: number, mensaje: string): ResultadoCsvEquivalencias => ({ filas: [], errores: [{ linea, mensaje }], sinCompletar: 0 });
  if (typeof texto !== 'string' || texto.trim() === '') return fallo(0, 'El archivo está vacío.');
  if (texto.length > MAX_BYTES_CSV_SITIOS) return fallo(0, 'El archivo pesa más de 1 MB; divídelo en partes.');
  const limpio = texto.replace(/^﻿/, '');
  const sep = detectarSeparador(limpio.split(/\r?\n/, 1)[0] ?? '');
  const registros = partir(limpio, sep);
  const cabecera = (registros[0] ?? []).map((c) => ALIAS_COLUMNA_EQ[clave(c)] ?? `__${clave(c)}`);
  if (!cabecera.includes('texto')) return fallo(1, 'Falta la columna «texto» en la cabecera.');
  if (!cabecera.includes('tipo') && !cabecera.includes('geocerca_codigo')) {
    return fallo(1, 'Falta la columna «geocerca_codigo» (o «tipo») en la cabecera: sin ellas no hay a qué sitio ligar el texto.');
  }
  const cuerpo = registros.slice(1).map((r, i) => ({ linea: i + 2, celdas: r })).filter((r) => r.celdas.some((c) => c.trim() !== ''));
  if (cuerpo.length === 0) return fallo(0, 'El archivo no trae filas debajo de la cabecera.');
  if (cuerpo.length > MAX_FILAS_EQUIVALENCIAS) return fallo(0, `El archivo trae ${cuerpo.length} filas; el máximo por importación es ${MAX_FILAS_EQUIVALENCIAS}.`);

  const filas: EquivalenciaCsv[] = [];
  const errores: ErrorCsv[] = [];
  const vistas = new Map<string, number>();
  let sinCompletar = 0;
  for (const { linea, celdas } of cuerpo) {
    const v: Record<string, string> = {};
    cabecera.forEach((col, i) => { if (!col.startsWith('__')) v[col] = (celdas[i] ?? '').trim(); });
    const falla = (mensaje: string) => errores.push({ linea, mensaje });

    const textoFila = (v.texto ?? '').replace(/\s+/g, ' ');
    const codigo = v.geocerca_codigo ?? '';
    const tipoTxt = v.tipo ?? '';
    if (tipoTxt === '' && codigo === '' && textoFila !== '') { sinCompletar++; continue; }
    if (!textoFila) { falla('El texto es obligatorio.'); continue; }
    if (textoFila.length > MAX_LARGO_TEXTO_EQUIVALENCIA) { falla(`El texto admite hasta ${MAX_LARGO_TEXTO_EQUIVALENCIA} caracteres.`); continue; }
    const textoNormalizado = normalizarTextoEquivalencia(textoFila);
    if (!textoNormalizado) { falla('El texto no tiene letras ni números: no hay nada que comparar.'); continue; }

    let tipo: TipoEquivalencia;
    if (tipoTxt === '') tipo = 'sitio';
    else {
      const t = ALIAS_TIPO_EQ[clave(tipoTxt)];
      if (!t) { falla(`El tipo «${tipoTxt}» no es válido. Usa: sitio, sin_sitio (o instruccion), ignorar.`); continue; }
      tipo = t;
    }
    if (tipo === 'sitio' && codigo === '') { falla('Con tipo «sitio» hay que indicar el código del sitio en «geocerca_codigo».'); continue; }
    if (tipo !== 'sitio' && codigo !== '') {
      falla(`Un texto marcado «${tipo}» no es un lugar y no lleva sitio: quita «geocerca_codigo» o cambia el tipo a «sitio».`);
      continue;
    }
    if (codigo.length > 40) { falla('El código del sitio admite hasta 40 caracteres.'); continue; }
    let lado: LadoEquivalencia = 'ambos';
    if ((v.lado ?? '') !== '') {
      const l = ALIAS_LADO_EQ[clave(v.lado)];
      if (!l) { falla(`El lado «${v.lado}» no es válido. Usa: origen, destino o ambos.`); continue; }
      lado = l;
    }
    const llave = `${textoNormalizado}|${lado}`;
    const previa = vistas.get(llave);
    if (previa !== undefined) { falla(`El texto ya aparece en la línea ${previa} con el mismo lado.`); continue; }
    vistas.set(llave, linea);
    filas.push({ linea, texto: textoFila, textoNormalizado, geocercaCodigo: tipo === 'sitio' ? codigo : null, tipo, lado });
  }
  return { filas, errores, sinCompletar };
}

/** Una equivalencia que ya está guardada (para comparar y no reescribir lo que no cambió). */
export interface EquivalenciaGuardada {
  id: string;
  textoNormalizado: string;
  lado: LadoEquivalencia;
  tipo: TipoEquivalencia;
  geocercaId: string | null;
  clienteId: string | null;
}

export interface PlanEquivalencias {
  nuevas: Array<{ textoNormalizado: string; lado: LadoEquivalencia; tipo: TipoEquivalencia; geocercaId: string | null }>;
  cambios: Array<{ id: string; tipo: TipoEquivalencia; geocercaId: string | null }>;
  sinCambios: number;
  rechazadas: ErrorCsv[];
}

/**
 * Qué hay que escribir para que la base quede como dice el archivo. IDEMPOTENTE: lo que ya está igual cuenta como «sin cambios»
 * y no se toca (reimportar el mismo archivo = 0 cambios). Un código que no está en el catálogo se rechaza con una frase que
 * dice qué hacer; las demás filas siguen. `sitioPorCodigo` se indexa por código en minúsculas y solo trae sitios ACTIVOS de la flota.
 */
export function planificarEquivalencias(
  filas: readonly EquivalenciaCsv[], sitioPorCodigo: ReadonlyMap<string, string>, guardadas: readonly EquivalenciaGuardada[],
): PlanEquivalencias {
  const plan: PlanEquivalencias = { nuevas: [], cambios: [], sinCambios: 0, rechazadas: [] };
  const porLlave = new Map<string, EquivalenciaGuardada>();
  for (const g of guardadas) if (g.clienteId === null) porLlave.set(`${g.textoNormalizado}|${g.lado}`, g);
  for (const f of filas) {
    let geocercaId: string | null = null;
    if (f.tipo === 'sitio') {
      geocercaId = sitioPorCodigo.get((f.geocercaCodigo ?? '').toLowerCase()) ?? null;
      if (!geocercaId) {
        plan.rechazadas.push({ linea: f.linea, mensaje: `El sitio "${f.geocercaCodigo}" no existe en tu catálogo. Impórtalo primero en Sitios.` });
        continue;
      }
    }
    const previa = porLlave.get(`${f.textoNormalizado}|${f.lado}`);
    if (!previa) plan.nuevas.push({ textoNormalizado: f.textoNormalizado, lado: f.lado, tipo: f.tipo, geocercaId });
    else if (previa.tipo === f.tipo && previa.geocercaId === geocercaId) plan.sinCambios++;
    else plan.cambios.push({ id: previa.id, tipo: f.tipo, geocercaId });
  }
  return plan;
}

// ── La lista de «textos sin sitio» ──────────────────────────────────────────

export interface ViajeParaTextos {
  origen: string | null;
  destino: string | null;
  origenSitioId: string | null;
  destinoSitioId: string | null;
}

export interface TextoSinSitio {
  /** Cómo se escribe más seguido (para mostrar). */
  texto: string;
  textoNormalizado: string;
  /** `ambos` si aparece sin sitio tanto de origen como de destino. */
  lado: LadoEquivalencia;
  frecuencia: number;
}

/**
 * Los textos de origen/destino que NO tienen sitio (ni asignado al viaje ni cubierto por una equivalencia ya guardada), los más
 * frecuentes primero. El conteo es por lado y se junta por texto normalizado; el desempate es alfabético para que la lista sea
 * estable. Un texto que ya tiene equivalencia para ese lado no vuelve a salir (la oficina ya decidió).
 */
export function contarTextosSinSitio(
  viajes: readonly ViajeParaTextos[],
  cubiertas: ReadonlyArray<{ textoNormalizado: string; lado: LadoEquivalencia }>,
  tope = TOP_TEXTOS_SIN_SITIO,
): TextoSinSitio[] {
  const cubre = (n: string, lado: 'origen' | 'destino') => cubiertas.some((c) => c.textoNormalizado === n && (c.lado === 'ambos' || c.lado === lado));
  const porTexto = new Map<string, { origen: number; destino: number; variantes: Map<string, number> }>();
  for (const v of viajes) {
    for (const lado of ['origen', 'destino'] as const) {
      const crudo = (lado === 'origen' ? v.origen : v.destino)?.replace(/\s+/g, ' ').trim().slice(0, MAX_LARGO_TEXTO_EQUIVALENCIA) ?? '';
      const sitio = lado === 'origen' ? v.origenSitioId : v.destinoSitioId;
      if (!crudo || sitio) continue;
      const n = normalizarTextoEquivalencia(crudo);
      if (!n || cubre(n, lado)) continue;
      const e = porTexto.get(n) ?? { origen: 0, destino: 0, variantes: new Map<string, number>() };
      e[lado]++;
      e.variantes.set(crudo, (e.variantes.get(crudo) ?? 0) + 1);
      porTexto.set(n, e);
    }
  }
  const lista: TextoSinSitio[] = [];
  for (const [n, e] of porTexto) {
    const variante = [...e.variantes.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0][0];
    lista.push({
      texto: variante, textoNormalizado: n, lado: e.origen > 0 && e.destino > 0 ? 'ambos' : e.origen > 0 ? 'origen' : 'destino', frecuencia: e.origen + e.destino,
    });
  }
  lista.sort((a, b) => b.frecuencia - a.frecuencia || a.textoNormalizado.localeCompare(b.textoNormalizado));
  return lista.slice(0, tope);
}

const celdaCsv = (t: string): string => {
  // Un texto que empieza como fórmula no se ejecuta al abrirlo en una hoja de cálculo (la normalización ignora el apóstrofo).
  const seguro = /^[=+\-@\t\r]/.test(t) ? `'${t}` : t;
  return /[",\n\r]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/**
 * El listado como CSV para que el cliente lo complete. Solo trae el texto, el lado y cuántas veces salió: ningún nombre de
 * operador, teléfono ni folio. Las columnas `geocerca_codigo` y `tipo` van vacías; ESAS son las que se llenan. Vuelve a entrar
 * tal cual al importador (la columna `frecuencia` no la lee).
 */
export function csvTextosSinSitio(textos: readonly TextoSinSitio[]): string {
  const filas = textos.map((t) => [celdaCsv(t.texto), '', '', t.lado, String(t.frecuencia)].join(','));
  return ['texto,geocerca_codigo,tipo,lado,frecuencia', ...filas].join('\n') + '\n';
}
