// Replay LOCAL de un chat exportado de WhatsApp contra el clasificador y `decidirAccion` del Vigía. Script MANUAL, fuera de CI.
//
//   npx tsx scripts/vigia/replay-chat.ts "<ruta al .txt exportado>" \
//     --equipo "Nombre uno,Nombre dos"      # nombres, tal como salen en el chat, de la gente de la flota (el resto es cliente)
//     [--sal "<texto>"]                     # sal del hash de autor (por omisión una sal local; el hash no se imprime)
//     [--umbral-min 60]                     # minutos sin respuesta a partir de los cuales un mensaje cuenta como «lento»
//
// PURO sobre el archivo: no toca base, red ni modelo (el clasificador corre solo con reglas). Solo lee la ruta indicada.
// PRIVACIDAD: imprime ÚNICAMENTE agregados (conteos, medianas, distribuciones). Nunca el texto de un mensaje, ni un autor,
// ni un hash, ni la ruta del archivo. No guardes exportaciones reales dentro del repo (es público).
import { readFileSync } from 'node:fs';
import { leerExportWhatsapp, type MensajeHistorial } from '../../src/lib/likida/vigia/historial/export_whatsapp';
import { clasificar } from '../../src/lib/likida/vigia/clasificador';
import { decidirAccion } from '../../src/lib/likida/vigia/conocimiento/decidir';
import { numero, round2 } from '../../src/lib/formato';

interface Opciones { ruta: string; equipo: string[]; sal: string; umbralMin: number }

function leerArgs(argv: readonly string[]): Opciones {
  const pos: string[] = [];
  const val = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a.startsWith('--')) { val.set(a.slice(2), argv[i + 1] ?? ''); i += 1; } else pos.push(a);
  }
  if (pos.length !== 1) throw new Error('Uso: replay-chat.ts "<ruta del export .txt>" --equipo "A,B" [--sal x] [--umbral-min 60]');
  const equipo = (val.get('equipo') ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (equipo.length === 0) throw new Error('Falta --equipo: sin los nombres del equipo no se puede separar cliente de flota.');
  const umbral = Number(val.get('umbral-min') ?? '60');
  return { ruta: pos[0], equipo, sal: val.get('sal') ?? 'replay-local', umbralMin: Number.isFinite(umbral) && umbral > 0 ? umbral : 60 };
}

const fmt = (n: number): string => numero(round2(n));
const cuantil = (orden: readonly number[], q: number): number => (orden.length === 0 ? 0 : orden[Math.min(orden.length - 1, Math.floor(q * orden.length))]);

function distribucion(claves: readonly string[]): Array<[string, number]> {
  const m = new Map<string, number>();
  for (const k of claves) m.set(k, (m.get(k) ?? 0) + 1);
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export interface MetricasReplay {
  mensajes: number; cliente: number; equipo: number;
  esperas: { atendidos: number; sinAtender: number; lentos: number; medianaMin: number; p90Min: number; maxMin: number };
  intenciones: Array<[string, number]>;
  acciones: Array<[string, number]>;
  endurecen: { escalar: number; noResponder: number; conDatos: number };
}

/** Un «bloque» son mensajes seguidos del cliente sin respuesta del equipo en medio: se mide desde el primero. */
export async function calcularMetricas(mensajes: readonly MensajeHistorial[], umbralMin: number): Promise<MetricasReplay> {
  const orden = [...mensajes].sort((a, b) => a.enviadoEn.localeCompare(b.enviadoEn));
  const esperas: number[] = [];
  let sinAtender = 0;
  let inicio: number | null = null;
  for (const m of orden) {
    const t = Date.parse(m.enviadoEn);
    if (m.rol === 'cliente') { if (inicio === null) inicio = t; } else if (inicio !== null) { esperas.push((t - inicio) / 60_000); inicio = null; }
  }
  if (inicio !== null) sinAtender += 1;
  esperas.sort((a, b) => a - b);

  const intenciones: string[] = [];
  const acciones: string[] = [];
  let escalar = 0; let noResponder = 0; let conDatos = 0;
  for (const m of orden) {
    if (m.rol !== 'cliente') continue;
    const cl = await clasificar(m.texto);
    intenciones.push(cl.intencion);
    // Sin datos confirmados: mide qué tan a menudo la matriz mandaría a una persona (el peor caso, el más conservador).
    const d = decidirAccion({ texto: cl.textoLimpio, datosDisponibles: [], contexto: { emisor: 'cliente', canal: 'whatsapp' } });
    acciones.push(d.accion);
    if (d.accion === 'responder_con_datos') conDatos += 1;
    else if (d.accion === 'prohibido' || d.accion === 'solo_registrar') noResponder += 1;
    else escalar += 1;
  }
  return {
    mensajes: orden.length,
    cliente: orden.filter((m) => m.rol === 'cliente').length,
    equipo: orden.filter((m) => m.rol === 'equipo').length,
    esperas: {
      atendidos: esperas.length, sinAtender, lentos: esperas.filter((e) => e >= umbralMin).length,
      medianaMin: cuantil(esperas, 0.5), p90Min: cuantil(esperas, 0.9), maxMin: esperas.length ? esperas[esperas.length - 1] : 0,
    },
    intenciones: distribucion(intenciones),
    acciones: distribucion(acciones),
    endurecen: { escalar, noResponder, conDatos },
  };
}

async function main(): Promise<void> {
  const o = leerArgs(process.argv.slice(2));
  // La ruta la pone quien corre el script a mano (herramienta local): es la entrada esperada.
  // eslint-disable-next-line security/detect-non-literal-fs-filename
  const r = leerExportWhatsapp(readFileSync(o.ruta, 'utf8'), { equipo: o.equipo, sal: o.sal });
  const m = await calcularMetricas(r.mensajes, o.umbralMin);
  const L: string[] = [];
  L.push('REPLAY DEL CHAT (solo agregados; sin texto ni autores)');
  L.push(`Formato: ${r.formato} · mensajes leídos: ${m.mensajes} (cliente ${m.cliente}, equipo ${m.equipo}) · descartados: ${r.descartados} · adjuntos omitidos: ${r.adjuntosOmitidos} · fechas inválidas: ${r.fechasInvalidas}${r.truncado ? ' · TRUNCADO (solo el principio del chat)' : ''}`);
  L.push('');
  L.push(`Tiempos de respuesta (minutos desde el primer mensaje del bloque del cliente hasta la primera respuesta del equipo):`);
  L.push(`  bloques atendidos: ${m.esperas.atendidos} · mediana ${fmt(m.esperas.medianaMin)} · p90 ${fmt(m.esperas.p90Min)} · máximo ${fmt(m.esperas.maxMin)}`);
  L.push(`  lentos (>= ${o.umbralMin} min): ${m.esperas.lentos} · mensajes sin atender al final del chat: ${m.esperas.sinAtender}`);
  L.push('');
  L.push('Intenciones del cliente (clasificador por reglas):');
  for (const [k, n] of m.intenciones) L.push(`  ${k}: ${n}`);
  L.push('');
  L.push('Decisión de la matriz sin datos confirmados (el caso más conservador):');
  for (const [k, n] of m.acciones) L.push(`  ${k}: ${n}`);
  L.push(`  → pide persona: ${m.endurecen.escalar} · no responder/solo registrar: ${m.endurecen.noResponder} · respondería con datos: ${m.endurecen.conDatos}`);
  process.stdout.write(`${L.join('\n')}\n`);
}

if (process.argv[1] && /replay-chat\.ts$/.test(process.argv[1])) {
  main().catch((e: unknown) => { process.stderr.write(`${e instanceof Error ? e.message : 'error'}\n`); process.exit(1); });
}
