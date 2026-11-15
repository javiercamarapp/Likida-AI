// ═══════════════════════════════════════════════════════════════════════════
// LA VIGILANCIA NORMATIVA, SIN RED NI BASE: lógica pura que recibe un `traer` (el fetch) y el estado previo y devuelve
// el estado nuevo y los avisos. La ruta (`/api/cron/vigilancia-normativa`) solo cablea el interruptor, el latido y el
// correo. Así cada regla de abajo se prueba con respuestas SIDOF simuladas.
//
// REGLAS QUE ESTE MÓDULO NO NEGOCIA:
//   · El cursor `ultimoDiaBarrido` solo avanza sobre días LEÍDOS DE VERDAD y respaldados por `diarios`. Un día con fallo
//     de la fuente o de red NO lo mueve, y los días siguientes no se «saltan»: el cursor es lineal.
//   · Nunca se declara «sin cambios» sin haber leído notas. Un día hábil con 0 notas es fallo, no tranquilidad.
//   · Esta rutina NO cambia ninguna ficha ni escribe en `normas/`: solo avisa. La lectura la hace una persona.
//   · Cortesía a un sitio de gobierno: secuencial, pausa entre días, máximo `MAX_FETCH` peticiones por corrida.
// ═══════════════════════════════════════════════════════════════════════════

import { clasificarTitulo } from './disparadores';
import { evaluarDia, type RespuestaHttp } from './dof';
import { aFormatoSidof, diasEntre, diaDeSemana, hoyMx, sumarDias } from './fechas';
import { TOPE_PENDIENTES, TOPE_VISTOS, type Aviso, type EstadoVigilancia } from './estado';

export const URL_SIDOF = 'https://sidofqa.segob.gob.mx/dof/sidof';
export const URL_SAT: Record<string, string> = {
  '2026': 'https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2026.html',
  '2027': 'https://www.sat.gob.mx/minisitio/NormatividadRMFyRGCE/normatividad_rmf_rgce2027.html',
};
export const LEYES = ['CFF', 'LISR', 'LIVA', 'LFPDPPP'] as const;
export const urlLey = (ley: string): string => `https://www.diputados.gob.mx/LeyesBiblio/pdf/${ley}.pdf`;

/** Tope de peticiones por corrida (cortesía + presupuesto de tiempo). */
export const MAX_FETCH = 25;
/** Tope de días por corrida: si hay rezago se pone al día en las siguientes y el latido lo declara. */
export const MAX_DIAS = 10;
/** Primera corrida: empezar tantos días atrás. */
export const DIAS_INICIALES = 7;
/** Pausa entre días (ms). */
export const PAUSA_ENTRE_DIAS_MS = 400;
/** Tiempo que se le exige a la corrida para empezar un día más (dos peticiones de hasta 12 s + pausa). */
export const MARGEN_POR_DIA_MS = 26_000;
/** Corridas seguidas en que `diarios` y `notas` coinciden en «no hubo DOF» un día hábil antes de darlo por feriado. */
export const INTENTOS_FERIADO = 3;

/** Dos lecturas del `Last-Modified` de la MISMA página que difieren menos de esto son ruido de balanceo, no un cambio. */
export const TOLERANCIA_LAST_MODIFIED_MS = 10 * 60_000;

function normalizarEtag(e: string | null): string | null {
  return e === null ? null : e.replace(/^W\//, '').replace(/-(gunzip|gzip|br|deflate)/g, '').replace(/"/g, '');
}

/**
 * ¿Cambió de verdad el recurso? El minisitio del SAT sale de varios nodos cuyos `Last-Modified` y `ETag` (el prefijo del
 * ETag ES el mtime en hexadecimal) difieren por segundos entre sí y con la compresión (`W/"…-gunzip-gzip"`): medido el
 * 14-nov-2026, 00:14:54 contra 00:15:11 para la misma página. Comparar cadenas crudas mandaría un falso «anticipada SAT»
 * cada vez que el balanceador cambie de nodo. Con fechas legibles en ambos lados, se exige una diferencia mayor que la
 * tolerancia; si no, se comparan ETag normalizados.
 */
export function cambioReal(
  guardado: { etag: string | null; lastModified: string | null },
  actual: { etag: string | null; lastModified: string | null },
): boolean {
  const g = guardado.lastModified === null ? NaN : Date.parse(guardado.lastModified);
  const a = actual.lastModified === null ? NaN : Date.parse(actual.lastModified);
  if (Number.isFinite(g) && Number.isFinite(a)) return Math.abs(a - g) > TOLERANCIA_LAST_MODIFIED_MS;
  if (guardado.lastModified !== actual.lastModified) return true;
  return normalizarEtag(guardado.etag) !== normalizarEtag(actual.etag);
}

export type Traer = (url: string, metodo: 'GET' | 'HEAD') => Promise<RespuestaHttp>;

export interface Entrada {
  estado: EstadoVigilancia;
  ahora: Date;
  traer: Traer;
  /** Espera entre días; se inyecta para que las pruebas no esperen de verdad. */
  pausar: (ms: number) => Promise<void>;
  /** Reloj de pared (ms) y el límite de la función; la corrida no empieza un día que no alcance a terminar. */
  reloj: () => number;
  venceEn: number;
}

export interface FalloCorrida { codigo: string; causa: string; dia?: string }

export interface Resultado {
  estado: EstadoVigilancia;
  /** Avisos NUEVOS de esta corrida (ya están también en `estado.pendientes`). */
  nuevos: Aviso[];
  fallos: FalloCorrida[];
  diasBarridos: number;
  notasRevisadas: number;
  sinTitulo: number;
  disparadores: number;
  /** Días que faltan entre el cursor nuevo y ayer. */
  rezagoDias: number;
  peticiones: number;
  /** El reloj no alcanzó para todos los días planeados. */
  sinTurno: boolean;
  ayer: string;
  corrioSemanal: boolean;
  corrioTrimestral: boolean;
}

function lineaDof(fecha: string, edicion: string, titulo: string, etiquetas: string[], fichas: string[], cod: number): string {
  const fichasTxt = fichas.length === 0
    ? 'revisar fichas del tema'
    : `fichas: ${fichas.slice(0, 4).join(', ')}${fichas.length > 4 ? ` (+${fichas.length - 4})` : ''}`;
  const base = `${aFormatoSidof(fecha)} · ${edicion} · [${etiquetas.join(', ')}] · ${URL_SIDOF}/notas/nota/${cod} · ${fichasTxt} · `;
  const cupo = Math.max(40, 295 - base.length);
  return `${base}${titulo.length > cupo ? `${titulo.slice(0, cupo - 1)}…` : titulo}`;
}

/** Corre la vigilancia. No lanza por fallos de red: los convierte en `fallos`. */
export async function ejecutarVigilancia(entrada: Entrada): Promise<Resultado> {
  const { ahora, traer, pausar, reloj, venceEn } = entrada;
  const previo = entrada.estado;
  const hoy = hoyMx(ahora);
  const ayer = sumarDias(hoy, -1);
  const [anio, mes] = hoy.split('-').map(Number);

  let peticiones = 0;
  const pedir = async (url: string, metodo: 'GET' | 'HEAD'): Promise<RespuestaHttp> => {
    peticiones += 1;
    return traer(url, metodo);
  };

  // ── Qué toca hoy ─────────────────────────────────────────────────────
  const semanalToca = previo.ultimoSemanal === null
    || (diaDeSemana(hoy) === 1 && previo.ultimoSemanal !== hoy)
    || diasEntre(previo.ultimoSemanal, hoy) >= 7;
  const claveTrimestre = `${anio}-${mes}`;
  const trimestralToca = previo.ultimoTrimestral === null
    || ([1, 4, 7, 10].includes(mes) && previo.ultimoTrimestral !== claveTrimestre);
  const reserva = (semanalToca ? 2 : 0) + (trimestralToca ? LEYES.length : 0);
  const maxDias = Math.min(MAX_DIAS, Math.floor((MAX_FETCH - reserva) / 2));

  const estado: EstadoVigilancia = {
    ...previo,
    vistos: [...previo.vistos],
    pendientes: [...previo.pendientes],
    sat: { ...previo.sat },
    leyes: { ...previo.leyes },
    diasSinEdicion: [...previo.diasSinEdicion],
  };
  const nuevos: Aviso[] = [];
  const fallos: FalloCorrida[] = [];
  const conocidos = new Set<number>([...estado.vistos, ...estado.pendientes.flatMap((p) => (p.codNota === undefined ? [] : [p.codNota]))]);

  // ── 1. DIARIO: el barrido del DOF ────────────────────────────────────
  const cursorInicial = previo.ultimoDiaBarrido ?? sumarDias(hoy, -(DIAS_INICIALES + 1));
  let cursor = cursorInicial;
  let hayFalloLineal = false;
  let redCaida = false;
  let retenidoNuevo: EstadoVigilancia['retenido'] = null;
  let diasBarridos = 0;
  let notasRevisadas = 0;
  let sinTitulo = 0;
  let disparadores = 0;
  let sinTurno = false;
  const ultimoPlaneado = sumarDias(cursorInicial, maxDias) < ayer ? sumarDias(cursorInicial, maxDias) : ayer;

  for (let dia = sumarDias(cursorInicial, 1); dia <= ultimoPlaneado; dia = sumarDias(dia, 1)) {
    if (reloj() + MARGEN_POR_DIA_MS > venceEn) { sinTurno = true; break; }
    if (diasBarridos > 0) await pausar(PAUSA_ENTRE_DIAS_MS);
    const fechaSidof = aFormatoSidof(dia);
    let diarios: RespuestaHttp;
    let notas: RespuestaHttp;
    try {
      diarios = await pedir(`${URL_SIDOF}/diarios/porFecha/${fechaSidof}`, 'GET');
      notas = await pedir(`${URL_SIDOF}/notas/${fechaSidof}`, 'GET');
    } catch (e) {
      // Un fallo de NUESTRA red no es «sin cambios» ni «el DOF no salió»: el cursor se queda en el día anterior y no
      // se insiste con los días siguientes (si la red cayó, caerían igual).
      fallos.push({ codigo: 'red', causa: e instanceof Error ? e.message : String(e), dia });
      hayFalloLineal = true;
      redCaida = true;
      break;
    }
    diasBarridos += 1;
    let r = evaluarDia(dia, diarios, notas);

    // Un día hábil que `diarios` Y `notas` dicen vacío, corrida tras corrida, es un feriado sin DOF y no una caída:
    // el SIDOF no da un tercer testigo. Solo en ese caso, y tras INTENTOS_FERIADO corridas, se acepta como día sin
    // edición (queda declarado en `diasSinEdicion` y en el latido). Cualquier otro fallo se retiene siempre.
    if (r.fallo && !hayFalloLineal && r.fallo.codigo === 'dia_habil_sin_notas' && r.fallo.diariosSinEdicion) {
      const intentos = (previo.retenido?.dia === dia ? previo.retenido.intentos : 0) + 1;
      if (intentos >= INTENTOS_FERIADO) {
        r = { ...r, fallo: null };
        estado.diasSinEdicion = [...estado.diasSinEdicion, dia].slice(-10);
      } else {
        retenidoNuevo = { dia, intentos };
      }
    }

    if (r.fallo) {
      fallos.push({ codigo: r.fallo.codigo, causa: r.fallo.causa, dia });
      hayFalloLineal = true;
    } else if (!hayFalloLineal) {
      cursor = dia;
    }

    // Lo que SÍ se leyó se revisa aunque el cursor no avance (el dedup por codNota evita repetirlo mañana).
    if (!r.fallo || r.fallo.codigo === 'dia_habil_sin_notas') {
      notasRevisadas += r.notas.length;
      sinTitulo += r.sinTitulo;
      for (const n of r.notas) {
        if (n.titulo === null) continue;
        const c = clasificarTitulo(n.titulo);
        if (!c || conocidos.has(n.codNota)) continue;
        conocidos.add(n.codNota);
        disparadores += 1;
        nuevos.push({ tipo: 'dof', codNota: n.codNota, linea: lineaDof(dia, n.edicion, n.titulo, c.etiquetas, c.fichas, n.codNota) });
      }
    }
  }
  estado.ultimoDiaBarrido = cursor;
  estado.retenido = retenidoNuevo;

  // ── 2. SEMANAL: anticipadas del SAT (HEAD al minisitio) ──────────────
  let corrioSemanal = false;
  if (semanalToca && !redCaida) {
    corrioSemanal = true;
    let ok2026 = false;
    for (const variante of ['2026', '2027']) {
      try {
        const r = await pedir(URL_SAT[variante], 'HEAD');
        if (r.status === 404 && variante === '2027') continue; // aún no existe: se ignora sin alarma
        if (r.status !== 200) {
          fallos.push({ codigo: 'sat_head', causa: `HEAD al minisitio ${variante} respondió HTTP ${r.status}` });
          continue;
        }
        if (variante === '2026') ok2026 = true;
        const guardado = estado.sat[variante] ?? null;
        const actual = { etag: r.etag, lastModified: r.lastModified };
        estado.sat[variante] = actual;
        if (guardado === null) {
          // Primera vez que responde 200: la 2026 es la línea base; una 2027 NUEVA con la base ya tomada es noticia.
          if (variante === '2027' && previo.sat['2026']) {
            nuevos.push({ tipo: 'sat', linea: `Minisitio SAT: apareció la variante 2027 (${URL_SAT['2027']}) · anticipada SAT posible · revisar el listado de PDFs` });
          }
          continue;
        }
        if (cambioReal(guardado, actual)) {
          nuevos.push({
            tipo: 'sat',
            linea: `Minisitio SAT ${variante} cambió (ETag ${guardado.etag ?? '—'} → ${actual.etag ?? '—'}; Last-Modified ${actual.lastModified ?? '—'}) · anticipada SAT posible · diffear la lista de PDFs: ${URL_SAT[variante]}`,
          });
        }
      } catch (e) {
        fallos.push({ codigo: 'sat_head', causa: `HEAD al minisitio ${variante}: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    if (ok2026) estado.ultimoSemanal = hoy;
  }

  // ── 3. TRIMESTRAL: deriva de ley (HEAD a los PDF de diputados) ───────
  let corrioTrimestral = false;
  if (trimestralToca && !redCaida) {
    corrioTrimestral = true;
    let todas = true;
    for (const ley of LEYES) {
      try {
        const r = await pedir(urlLey(ley), 'HEAD');
        if (r.status !== 200) { todas = false; fallos.push({ codigo: 'ley_head', causa: `HEAD a ${ley}.pdf respondió HTTP ${r.status}` }); continue; }
        const guardado = estado.leyes[ley] ?? null;
        estado.leyes[ley] = r.lastModified;
        if (guardado !== null && cambioReal({ etag: null, lastModified: guardado }, { etag: null, lastModified: r.lastModified })) {
          nuevos.push({ tipo: 'ley', linea: `Deriva de ley: ${ley} cambió su Last-Modified (${guardado} → ${r.lastModified ?? '—'}) · diffear el historial en https://www.diputados.gob.mx/LeyesBiblio/ref/${ley.toLowerCase()}.htm` });
        }
      } catch (e) {
        todas = false;
        fallos.push({ codigo: 'ley_head', causa: `HEAD a ${ley}.pdf: ${e instanceof Error ? e.message : String(e)}` });
      }
    }
    if (todas) estado.ultimoTrimestral = claveTrimestre;
  }

  // ── Cierre: pendientes acotados y fallos seguidos ────────────────────
  estado.pendientes = [...estado.pendientes, ...nuevos].slice(-TOPE_PENDIENTES);
  estado.fallosSeguidos = fallos.length > 0 ? previo.fallosSeguidos + 1 : 0;

  return {
    estado, nuevos, fallos, diasBarridos, notasRevisadas, sinTitulo, disparadores,
    rezagoDias: diasEntre(cursor, ayer),
    peticiones, sinTurno, ayer, corrioSemanal, corrioTrimestral,
  };
}

/** Marca como avisados (ya salió el correo): pasan a `vistos` (acotado) y se vacían los pendientes. */
export function marcarAvisados(estado: EstadoVigilancia, avisados: Aviso[]): EstadoVigilancia {
  const cods = avisados.flatMap((a) => (a.codNota === undefined ? [] : [a.codNota]));
  const salieron = new Set(avisados.map((a) => a.linea));
  return {
    ...estado,
    vistos: [...estado.vistos, ...cods.filter((c) => !estado.vistos.includes(c))].slice(-TOPE_VISTOS),
    pendientes: estado.pendientes.filter((p) => !salieron.has(p.linea)),
  };
}
