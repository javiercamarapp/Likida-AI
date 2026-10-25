// ═══════════════════════════════════════════════════════════════════════════
// CORREOS Y COORDINADORES DE LOS OPERADORES, DESDE UN CSV (T-A1-23).
//
// Archivo: `numero_empleado;correo;coordinador_nombre;coordinador_correo` (el separador y el formato de celda los
// resuelve quien lee el archivo; aquí entra la matriz cruda, fila 0 = encabezados, como en `importacion/operadores.ts`).
//
// Qué hace por fila:
//   · busca al operador por `numero_empleado` — NUNCA lo crea (la alta masiva de operadores es otra puerta) y NUNCA toca
//     `telefono`: solo `correo` y `coordinador_id`;
//   · valida la forma del correo (la misma regla de la migración 0785) antes de tocar nada;
//   · si trae coordinador, lo busca/crea por (flota, correo en minúsculas) y se lo asigna al operador;
//   · una celda de correo vacía NO borra el correo que ya había (borrar no es el trabajo de un import).
//
// Es IDEMPOTENTE: volver a subir el mismo archivo no cambia nada (todo cae en «sin cambios») ni vuelve a escribir.
//
// Sin I/O propio: el acceso a datos entra por `PuertoContactos` (el adaptador real lo cablea la pantalla de T-A1-30
// sobre `repo_correo.ts`, el único acceso a datos del frente). Así la lógica se prueba sin base.
//
// PII: los correos NUNCA van a logs ni a los mensajes del informe: se habla de «fila N» y del motivo, jamás del valor.
// ═══════════════════════════════════════════════════════════════════════════

import {
  type Descartada, TOPE_FILAS_IMPORTACION, detectarColumnas, filaVacia, celdaTexto, encabezadosLeidos, avisoDeTope,
} from '../importacion/archivo';

/** Misma regla que `liquidacion_coordinador_correo_forma` (0785). */
const FORMA_CORREO = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_CORREO = 254;
const MAX_NOMBRE = 200;

/** Encabezados que el mundo real usa. Minúsculas, sin acentos (ver `normalizarEncabezado`). */
export const COLUMNAS_CONTACTOS = {
  numeroEmpleado: ['numero empleado', 'numero de empleado', 'no empleado', 'no. empleado', 'no. de empleado', 'no de empleado', 'num empleado', 'n de empleado', 'empleado', 'clave', 'numero_empleado', 'numero_de_empleado'],
  correo: ['correo', 'correo electronico', 'email', 'e mail', 'mail', 'correo operador', 'correo del operador'],
  coordinadorNombre: ['coordinador nombre', 'coordinador', 'nombre coordinador', 'nombre del coordinador', 'coordinador_nombre', 'supervisor', 'jefe de flota'],
  coordinadorCorreo: ['coordinador correo', 'correo coordinador', 'correo del coordinador', 'coordinador_correo', 'email coordinador', 'correo supervisor'],
} as const;

export const ENCABEZADOS_CONTACTOS = ['numero_empleado', 'correo', 'coordinador_nombre', 'coordinador_correo'] as const;

export interface ContactoImportado {
  /** Renglón del archivo (1-based, contando el encabezado) para poder decir «fila 14: …». */
  fila: number;
  numeroEmpleado: string;
  /** Minúsculas y sin espacios; `null` si la celda venía vacía. */
  correo: string | null;
  coordinadorNombre: string | null;
  coordinadorCorreo: string | null;
}

export interface LecturaContactos {
  filas: ContactoImportado[];
  /** Filas que no se pueden aplicar (forma de correo, nombre sin correo, repetida, sin datos). */
  invalidas: Descartada[];
  /** Avisos que no frenan nada. */
  advertencias: string[];
  /** Solo cuando NO se pudo leer nada útil (archivo vacío, sin columnas) o el archivo rebasa el tope. */
  error?: string;
}

export const normalizarCorreoContacto = (v: string): string => v.trim().toLowerCase();
export const correoConForma = (c: string): boolean => c.length <= MAX_CORREO && FORMA_CORREO.test(c);

/**
 * La matriz cruda del archivo → filas válidas + inválidas con su motivo. PURA.
 * Sin columna de `numero_empleado` no hay importación (es la llave); sin ninguna de las otras tres tampoco hay nada
 * que actualizar.
 */
export function interpretarContactos(matriz: unknown[][]): LecturaContactos {
  if (!matriz.length) return { filas: [], invalidas: [], advertencias: [], error: 'El archivo está vacío.' };
  const indice = detectarColumnas(matriz[0] ?? [], COLUMNAS_CONTACTOS);
  if (indice.numeroEmpleado === undefined) {
    return {
      filas: [], invalidas: [], advertencias: [],
      error: `No encontré la columna del número de empleado. Encabezados leídos: ${encabezadosLeidos(matriz)}. Usa los encabezados numero_empleado;correo;coordinador_nombre;coordinador_correo y vuelve a subirlo.`,
    };
  }
  if (indice.correo === undefined && indice.coordinadorCorreo === undefined) {
    return {
      filas: [], invalidas: [], advertencias: [],
      error: `El archivo no trae ni la columna «correo» ni «coordinador_correo», así que no hay nada que actualizar. Encabezados leídos: ${encabezadosLeidos(matriz)}.`,
    };
  }

  const filas: ContactoImportado[] = [];
  const invalidas: Descartada[] = [];
  const advertencias: string[] = [];
  const empleadosVistos = new Map<string, number>();
  const correosVistos = new Map<string, number[]>();

  for (let f = 1; f < matriz.length && f <= TOPE_FILAS_IMPORTACION; f++) {
    const fila = matriz[f];
    if (filaVacia(fila)) continue;
    const numero = f + 1;
    const celda = (k: keyof typeof COLUMNAS_CONTACTOS, max: number): string =>
      indice[k] === undefined ? '' : celdaTexto(fila[indice[k] as number], max);

    const numeroEmpleado = celda('numeroEmpleado', 40);
    if (!numeroEmpleado) { invalidas.push({ fila: numero, motivo: 'no trae número de empleado — es la llave para encontrar al operador' }); continue; }

    const correoCrudo = celda('correo', 400);
    const coordCorreoCrudo = celda('coordinadorCorreo', 400);
    const coordNombre = celda('coordinadorNombre', MAX_NOMBRE + 1);

    const correo = correoCrudo ? normalizarCorreoContacto(correoCrudo) : null;
    const coordinadorCorreo = coordCorreoCrudo ? normalizarCorreoContacto(coordCorreoCrudo) : null;

    if (correo !== null && !correoConForma(correo)) {
      invalidas.push({ fila: numero, motivo: 'el correo del operador no tiene forma de correo (falta la @ o el dominio)' });
      continue;
    }
    if (coordinadorCorreo !== null && !correoConForma(coordinadorCorreo)) {
      invalidas.push({ fila: numero, motivo: 'el correo del coordinador no tiene forma de correo (falta la @ o el dominio)' });
      continue;
    }
    if (coordNombre && !coordinadorCorreo) {
      invalidas.push({ fila: numero, motivo: 'trae el nombre del coordinador pero no su correo — sin el correo no se le puede mandar nada' });
      continue;
    }
    if (coordNombre.length > MAX_NOMBRE) {
      invalidas.push({ fila: numero, motivo: `el nombre del coordinador pasa de ${MAX_NOMBRE} caracteres` });
      continue;
    }
    if (correo === null && coordinadorCorreo === null) {
      invalidas.push({ fila: numero, motivo: 'no trae correo del operador ni del coordinador — no hay nada que actualizar' });
      continue;
    }
    const repetida = empleadosVistos.get(numeroEmpleado.toLowerCase());
    if (repetida !== undefined) {
      invalidas.push({ fila: numero, motivo: `el número de empleado está repetido en el archivo (ya viene en la fila ${repetida})` });
      continue;
    }
    empleadosVistos.set(numeroEmpleado.toLowerCase(), numero);

    if (correo !== null) correosVistos.set(correo, [...(correosVistos.get(correo) ?? []), numero]);
    filas.push({ fila: numero, numeroEmpleado, correo, coordinadorNombre: coordNombre || null, coordinadorCorreo });
  }

  // A37-S48-06: dos operadores del archivo con el MISMO correo es casi siempre un copiar/pegar mal hecho, y el desglose
  // lleva sueldo y deducciones (LFPDPPP). Fail-closed: ninguna de esas filas se aplica; se reportan para corregirlas.
  const choque = new Set<number>();
  for (const filasDelBuzon of correosVistos.values()) {
    if (filasDelBuzon.length > 1) {
      for (const n of filasDelBuzon) {
        choque.add(n);
        invalidas.push({
          fila: n,
          motivo: `comparte el correo del operador con las filas ${filasDelBuzon.filter((o) => o !== n).join(', ')}: ese buzón recibiría el desglose de todos; corrige el archivo`,
        });
      }
    }
  }
  if (choque.size) {
    const aplicables = filas.filter((f) => !choque.has(f.fila));
    filas.length = 0;
    filas.push(...aplicables);
  }

  const tope = avisoDeTope(matriz);
  if (tope) return { filas, invalidas: [tope, ...invalidas], advertencias, error: tope.motivo };
  return { filas, invalidas, advertencias };
}

// ── Aplicar ─────────────────────────────────────────────────────────────────

export interface OperadorContacto { id: string; correo: string | null; coordinadorId: string | null }

/** El acceso a datos que necesita el import. Cada método ya viene acotado a la flota por quien lo implementa. */
export interface PuertoContactos {
  /** Operadores de la flota con esos números de empleado (varios por número si la flota repitió uno). */
  buscarOperadores(numerosEmpleado: readonly string[]): Promise<Map<string, OperadorContacto[]>>;
  /** Alta o recuperación por (flota, correo en minúsculas). Con `nombre`, completa el nombre; sin él no pisa el que haya. */
  asegurarCoordinador(c: { correo: string; nombre: string | null }): Promise<{ id: string; creado: boolean }>;
  /** Cambia solo lo indicado. Nunca toca `telefono`. */
  guardarContacto(operadorId: string, cambios: { correo?: string; coordinadorId?: string }): Promise<void>;
  /** Opcional: correos de la lista que YA usa algún operador distinto de los dados (comparten buzón con la flota). */
  correosEnUsoPorOtros?(correos: readonly string[], excluirOperadorIds: readonly string[]): Promise<ReadonlySet<string>>;
}

export interface InformeContactos {
  actualizados: number;
  /** El operador ya tenía exactamente esos datos (re-subir el mismo archivo cae aquí). */
  sinCambios: number;
  /** Filas cuyo número de empleado no existe en la flota: se reportan, no se crean. */
  sinOperador: Descartada[];
  /** Filas cuyo número de empleado corresponde a más de un operador: no se adivina cuál. */
  ambiguos: Descartada[];
  invalidas: Descartada[];
  coordinadoresNuevos: number;
  advertencias: string[];
  /** Si el archivo no se pudo leer. */
  error?: string;
}

/** «N actualizados / M sin operador / K inválidos» en lenguaje llano, sin ningún correo. */
export function resumenContactos(i: InformeContactos): string {
  if (i.error && i.actualizados === 0 && i.sinCambios === 0 && i.sinOperador.length === 0 && i.invalidas.length === 0) return i.error;
  const partes = [
    `${i.actualizados} actualizados`,
    `${i.sinOperador.length} sin operador`,
    `${i.invalidas.length} inválidos`,
  ];
  if (i.sinCambios) partes.push(`${i.sinCambios} sin cambios`);
  if (i.ambiguos.length) partes.push(`${i.ambiguos.length} con número repetido en la flota`);
  if (i.coordinadoresNuevos) partes.push(`${i.coordinadoresNuevos} coordinadores nuevos`);
  return partes.join(' / ');
}

/**
 * Aplica las filas ya validadas. Una fila que falla por el puerto lanza (no se finge haber guardado); las filas que no
 * se pueden aplicar por datos (sin operador, ambiguas) se REPORTAN y el resto sigue.
 */
export async function aplicarContactos(lectura: LecturaContactos, puerto: PuertoContactos): Promise<InformeContactos> {
  const informe: InformeContactos = {
    actualizados: 0, sinCambios: 0, sinOperador: [], ambiguos: [], invalidas: [...lectura.invalidas],
    coordinadoresNuevos: 0, advertencias: [...lectura.advertencias],
    ...(lectura.error ? { error: lectura.error } : {}),
  };
  if (!lectura.filas.length) return informe;

  const encontrados = await puerto.buscarOperadores(lectura.filas.map((f) => f.numeroEmpleado));

  // Primera pasada: qué filas tienen operador único. Nada se escribe todavía.
  let aplicables: Array<{ f: ContactoImportado; op: OperadorContacto }> = [];
  for (const f of lectura.filas) {
    const candidatos = encontrados.get(f.numeroEmpleado) ?? [];
    if (candidatos.length === 0) {
      informe.sinOperador.push({ fila: f.fila, motivo: 'no hay ningún operador con ese número de empleado en la flota (no se crea; da de alta al operador primero)' });
      continue;
    }
    if (candidatos.length > 1) {
      informe.ambiguos.push({ fila: f.fila, motivo: 'ese número de empleado lo tienen varios operadores de la flota; corrígelo en el registro antes de importar su correo' });
      continue;
    }
    aplicables.push({ f, op: candidatos[0] });
  }

  // A37-S48-06: los choques con correos de OTROS operadores se calculan ANTES de escribir y esas filas no se aplican:
  // avisar después de guardar dejaba salir el desglose de nómina al buzón equivocado. Si la consulta falla, lanza y no
  // se escribe nada (fail-closed).
  if (puerto.correosEnUsoPorOtros) {
    const conCorreo = aplicables.filter(({ f }) => f.correo !== null);
    if (conCorreo.length) {
      const ocupados = await puerto.correosEnUsoPorOtros(
        [...new Set(conCorreo.map(({ f }) => f.correo as string))],
        conCorreo.map(({ op }) => op.id),
      );
      if (ocupados.size > 0) {
        aplicables = aplicables.filter(({ f }) => {
          if (f.correo === null || !ocupados.has(f.correo)) return true;
          informe.invalidas.push({ fila: f.fila, motivo: 'el correo del operador ya lo usa otro operador de la flota: no se aplicó para que no le llegue su desglose a otra persona; corrígelo o quita ese correo al otro operador' });
          return false;
        });
      }
    }
  }

  const coordinadores = new Map<string, string>(); // correo → id, para no pedirlo dos veces en la misma corrida
  for (const { f, op } of aplicables) {
    let coordinadorId: string | undefined;
    if (f.coordinadorCorreo) {
      let id = coordinadores.get(f.coordinadorCorreo);
      if (id === undefined) {
        const r = await puerto.asegurarCoordinador({ correo: f.coordinadorCorreo, nombre: f.coordinadorNombre });
        id = r.id;
        coordinadores.set(f.coordinadorCorreo, id);
        if (r.creado) informe.coordinadoresNuevos++;
      }
      coordinadorId = id;
    }

    const cambios: { correo?: string; coordinadorId?: string } = {};
    if (f.correo !== null && f.correo !== (op.correo ?? '').toLowerCase()) cambios.correo = f.correo;
    if (coordinadorId !== undefined && coordinadorId !== op.coordinadorId) cambios.coordinadorId = coordinadorId;

    if (Object.keys(cambios).length === 0) { informe.sinCambios++; continue; }
    await puerto.guardarContacto(op.id, cambios);
    informe.actualizados++;
  }
  return informe;
}
