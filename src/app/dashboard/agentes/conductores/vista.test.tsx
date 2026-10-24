import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BloqueCola, BloqueConteos, TarjetaInsights, type ColaConductores, type ConteosConductores } from './vista';
import { calcularInsights, type EntradaInsights, type HitoParaInsights } from '@/lib/likida/conductor/insights';

// ═══════════════════════════════════════════════════════════════════════════
// FE-6 (auditoría 24): "Esperan aceptar" salía de `getViajes(tenantId)` (los
// 100 viajes más recientes) filtrados y ordenados en memoria — a 500
// viajes/día, ~4.8 h, así que el viaje avisado hace 6 h (el que el agente
// SÍ escala) ya no estaba en la ventana leída. Ahora sale de
// `viajesEsperandoAceptarPaginados`, que pregunta directo por
// avisado_en/aceptado_en/escalado_en con `count` real. Esta prueba fija que
// una lectura caída se dice — no se pinta como "nadie debe respuesta".
// ═══════════════════════════════════════════════════════════════════════════

async function pintar(cola: ColaConductores) {
  const el = await BloqueCola({ cola: Promise.resolve(cola), sufijo: '' });
  return renderToStaticMarkup(el);
}

describe('Conductores — "Esperan aceptar" con lectura dedicada (FE-6)', () => {
  it('lectura caída: dice que no se pudo leer, no "nadie debe respuesta"', async () => {
    const html = await pintar({ esperan: [], totalEsperan: null, sinAvisar: null, error: 'timeout' });
    expect(html).toContain('No se pudo leer la cola de aceptación');
    expect(html).not.toContain('Nadie debe respuesta');
  });

  it('con más en cola de las que se listan, declara el total MEDIDO', async () => {
    const cola: ColaConductores = {
      esperan: Array.from({ length: 20 }, (_, i) => ({
        id: `v${i}`, folio: `F-${i}`, operadorNombre: `Op ${i}`, horasDesdeAviso: 20 - i, avisos: 1,
      })),
      totalEsperan: 47, sinAvisar: null, error: null,
    };
    const html = await pintar(cola);
    expect(html).toContain('47');
    // No debe seguir afirmando que el resto son viajes "más antiguos": con el
    // orden por urgencia, lo que sobra del tope espera MENOS tiempo.
    expect(html).not.toContain('más antiguos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// FE-B1 (auditoría 28): `Pagina.truncada` tampoco lo leía esta pantalla. Aquí
// no hay botón "Siguiente" que pueda quedar muerto, pero SÍ hay que declarar
// que la cola no alcanza a mostrarlos todos cuando la lectura viene truncada
// — igual que `despacho/vista.tsx` y `descarga-sat/bandeja/vista.tsx`.
// ═══════════════════════════════════════════════════════════════════════════

describe('Conductores — "Esperan aceptar" declara el recorte de la paginación (FE-B1)', () => {
  it('con truncada=true, declara que hay más de los que esta lectura alcanza y ofrece el registro', async () => {
    const cola: ColaConductores = {
      esperan: Array.from({ length: 20 }, (_, i) => ({
        id: `v${i}`, folio: `F-${i}`, operadorNombre: `Op ${i}`, horasDesdeAviso: 20 - i, avisos: 1,
      })),
      totalEsperan: 6000, sinAvisar: null, error: null, truncada: true,
    };
    const html = await pintar(cola);
    expect(html).not.toContain('Siguiente');
    // Frase propia de la declaración del recorte — no la del "Se listan X de
    // Y" (esa ya existe y también menciona "registro", pero no dice que la
    // LECTURA misma no alcanza a traerlos a todos).
    expect(html).toContain('no alcanza a traerlos a todos');
  });

  it('sin truncada, no declara ningún recorte de la lectura', async () => {
    const cola: ColaConductores = {
      esperan: Array.from({ length: 5 }, (_, i) => ({
        id: `v${i}`, folio: `F-${i}`, operadorNombre: `Op ${i}`, horasDesdeAviso: 1, avisos: 1,
      })),
      totalEsperan: 5, sinAvisar: null, error: null, truncada: false,
    };
    const html = await pintar(cola);
    expect(html).not.toContain('no alcanza a traerlos a todos');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-06: «Aceptados» es lo que dijo el chofer; lo cargado por importación
// va en su propia tarjeta rotulada — dos cifras, nunca una mezclada.
// ═══════════════════════════════════════════════════════════════════════════

describe('Conductores — conteos separan chofer de importación (T-A5-06)', () => {
  const pintarConteos = async (k: ConteosConductores) =>
    renderToStaticMarkup(await BloqueConteos({ kpis: Promise.resolve(k) }));

  it('con importados medidos: rotula las dos cifras por separado', async () => {
    const html = await pintarConteos({ vivos: 12, aceptados: 3, importados: 5, esperan: 1, escalados: 0 });
    expect(html).toContain('Aceptados');
    expect(html).toContain('el chofer dijo que sí');
    expect(html).toContain('En seguimiento por importación');
    expect(html).toContain('no los aceptó el chofer');
  });

  it('sin el campo (origen viejo) no inventa la tarjeta', async () => {
    const html = await pintarConteos({ vivos: 12, aceptados: 3, esperan: 1, escalados: 0 });
    expect(html).not.toContain('En seguimiento por importación');
  });

  it('importados no medibles → «—», no 0', async () => {
    const html = await pintarConteos({ vivos: 12, aceptados: 3, importados: null, esperan: 1, escalados: 0 });
    expect(html).toContain('En seguimiento por importación');
    expect(html).toContain('no se pudo contar');
  });
});

describe('Conductores — tarjeta «Tiempo en aceptar» (T-A5-06)', () => {
  const pintarConteos = async (k: ConteosConductores) =>
    renderToStaticMarkup(await BloqueConteos({ kpis: Promise.resolve(k) }));
  const base = { vivos: 12, aceptados: 3, esperan: 1, escalados: 0 };

  it('muestra la media del chofer, su n y cuántos importados no cuenta', async () => {
    const html = await pintarConteos({ ...base, tiempoAceptacion: { minutos: 10, n: 3, excluidosImportados: 5 } });
    expect(html).toContain('Tiempo en aceptar');
    expect(html).toContain('10 min');
    expect(html).toContain('media de 3 aceptados por el chofer');
    expect(html).toContain('no cuenta 5 por importación');
  });

  it('sin viajes medibles → «—», no 0 min', async () => {
    const html = await pintarConteos({ ...base, tiempoAceptacion: { minutos: null, n: 0, excluidosImportados: 2 } });
    expect(html).toContain('aún sin aceptaciones del chofer que medir');
    expect(html).not.toContain('0 min');
  });

  it('lectura caída → «no se pudo medir»', async () => {
    const html = await pintarConteos({ ...base, tiempoAceptacion: null });
    expect(html).toContain('no se pudo medir');
  });

  it('sin el campo (origen viejo) no pinta la tarjeta', async () => {
    expect(await pintarConteos(base)).not.toContain('Tiempo en aceptar');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-26: lo simulado se rotula; nada técnico a la vista.
// ═══════════════════════════════════════════════════════════════════════════
describe('Conductores — datos de demostración rotulados y sin texto técnico (T-A5-26)', () => {
  it('en la cola, el folio DEMO- lleva SIMULADO y el real no', async () => {
    const html = await pintar({
      esperan: [
        { id: 'a', folio: 'DEMO-24001', operadorNombre: 'Op A', horasDesdeAviso: 2, avisos: 1 },
        { id: 'b', folio: 'F-9', operadorNombre: null, horasDesdeAviso: 1, avisos: 1 },
      ],
      totalEsperan: 2, sinAvisar: 1, error: null,
    });
    expect(html.match(/SIMULADO/g)?.length).toBe(1);
    expect(html).toContain('Sin operador');
  });

  it('la cola y los conteos no muestran identificadores internos', async () => {
    const cola = (await pintar({ esperan: [{ id: '3f2b8c1e-5d4a-4b6f-9a7e-1c2d3e4f5a6b', folio: 'F-1', operadorNombre: 'Op', horasDesdeAviso: 7, avisos: 2 }], totalEsperan: 90, sinAvisar: 2, error: null, truncada: true })).replace(/<[^>]*>/g, ' ');
    const conteos = renderToStaticMarkup(await BloqueConteos({ kpis: Promise.resolve({ vivos: 1, aceptados: 1, importados: 0, tiempoAceptacion: { minutos: 5, n: 1, excluidosImportados: 0 }, esperan: 1, escalados: 0 }) })).replace(/<[^>]*>/g, ' ');
    for (const visible of [cola, conteos]) {
      for (const re of [/aceptado_en/, /aceptado_origen/, /[a-z]{2,}_[a-z_]{2,}/, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i, /\bundefined\b/, /\bNaN\b/]) {
        expect(visible, String(re)).not.toMatch(re);
      }
    }
  });
});


// ═══════════════════════════════════════════════════════════════════════════
// T-A5-32: la tarjeta de insights — qué pasó · qué significa · qué hacer, y la fuente de cada número.
// Datos 100 % sintéticos: 20 hitos (14 por GPS, 4 por botón, 2 de oficina).
// ═══════════════════════════════════════════════════════════════════════════

const T0 = Date.parse('2026-03-02T12:00:00.000Z');
const iso = (min: number) => new Date(T0 + min * 60_000).toISOString();
const hitoI = (p: Partial<HitoParaInsights>): HitoParaInsights => ({ estado: 'recibido', fuente: 'sistema', mensajeEn: null, recibidoEn: null, ...p });

function entradaI(p: Partial<EntradaInsights> = {}): EntradaInsights {
  const hitos: HitoParaInsights[] = [];
  const cruces: Array<{ detectadoEn: string; registradoEn: string }> = [];
  for (let i = 0; i < 14; i++) {
    hitos.push(hitoI({ fuente: 'sistema', estado: 'validado' }));
    cruces.push({ detectadoEn: iso(i * 10), registradoEn: iso(i * 10 + (i + 1)) });
  }
  for (const r of [2, 4, 6, 8]) hitos.push(hitoI({ fuente: 'boton', mensajeEn: iso(0), recibidoEn: iso(r) }));
  for (let i = 0; i < 2; i++) hitos.push(hitoI({ fuente: 'oficina', estado: 'validado' }));
  // A37-S35-03: 3 hitos por viaje → los 18 sin intervención caen en 6 viajes.
  return { hitos: hitos.map((h, i) => ({ ...h, viajeId: `v${Math.floor(i / 3)}` })), cruces, episodios: [], viajesSinSitio: 0, lineaBase: { llamadasPorViaje: 2, registradaEn: '2026-02-20' }, ...p };
}

const pintarI = (e: EntradaInsights, discrepancias: number | null = null) =>
  renderToStaticMarkup(<TarjetaInsights insights={calcularInsights(e)} dias={7} discrepancias={discrepancias} />);

describe('Conductores — tarjeta de insights (T-A5-32)', () => {
  it('todo verde: las tres secciones, la frase de la ficha y la fuente de cada número', () => {
    const html = pintarI(entradaI());
    expect(html).toContain('Qué pasó');
    expect(html).toContain('Qué significa');
    expect(html).toContain('Qué hacer');
    expect(html).toContain('18 de 20 hitos se registraron sin que nadie los capturara');
    expect(html).toContain('Tu equipo dejó de teclear esos 18 registros');
    expect(html).toContain('Revisa los 2 que corrigió la oficina');
    // llamadas evitadas = 6 viajes × 2 = 12, rotulada como estimación con la fecha de la línea base
    expect(html).toContain('unas 12 llamadas evitadas');
    expect(html).not.toContain('unas 36');
    expect(html).toContain('Estimación con tu línea base de 2026-02-20');
    // cada número trae fuente y rótulo
    expect(html).toContain('fuente: viaje_hito.fuente');
    expect(html).toContain('fuente: viaje_cruce_geocerca.registrado_en − detectado_en');
    expect(html).toContain('medido');
    expect(html).toContain('estimación');
    // el tiempo del chofer no se presenta como la hora del evento físico
    expect(html).toContain('no cuándo ocurrió el evento físico');
  });

  it('con excepciones y discrepancias GPS vs chofer: las dice y manda a atenderlas', () => {
    const html = pintarI(entradaI({
      hitos: [...entradaI().hitos, hitoI({ estado: 'escalado', fuente: null })],
      episodios: [{ motivo: 'gps_obsoleto', aviso1En: iso(1), aviso2En: iso(21), escaladoEn: iso(41) }, { motivo: 'gps_detenido', aviso1En: iso(5), aviso2En: null, escaladoEn: null }],
      viajesSinSitio: 3,
    }), 4);
    expect(html).toContain('Hay 4 hitos donde lo que dijo el chofer no coincide con la ubicación del GPS');
    expect(html).toContain('Atiende 1 hitos escalados por falta de respuesta');
    expect(html).toContain('Revisa 2 episodios');
    expect(html).toContain('Asigna sitio a 3 viajes');
    expect(html).toContain('Chofer vs GPS sin coincidir');
    expect(html).toContain('viaje_senal_vida');
  });

  it('sin línea base: no inventa ahorro y pide la línea base', () => {
    const html = pintarI(entradaI({ lineaBase: null }));
    expect(html).toContain('Falta tu línea base: cuántas llamadas hacen hoy tus supervisores por viaje');
    expect(html).toContain('No se puede estimar cuántas llamadas se evitaron sin tu línea base');
    expect(html).not.toContain('Estimación con tu línea base');
    expect(html).not.toContain('llamadas evitadas (estimación, no medición)');
    // lo medido sigue ahí
    expect(html).toContain('18 de 20 hitos');
  });

  it('KPIs del piloto (T-A5-61): los 6 salen en la tarjeta; sin línea base dicen «sin dato», sin porcentaje inventado', () => {
    const html = pintarI(entradaI({ lineaBase: null }));
    expect(html).toContain('aria-label="KPIs del piloto"');
    for (const n of ['Hitos sin intervención', 'Minutos del GPS al registro', 'Viajes completos', 'Mensajes del supervisor evitados',
      'Tiempo de salida de terminal al primer cliente', 'Reubicaciones por cliente']) expect(html).toContain(n);
    // KPI 1 sí tiene valor medido (90 % = 18 de 20) pero NO base: la comparación dice «sin dato».
    expect(html).toContain('90 %');
    expect(html).toContain('sin dato');
    expect(html).not.toContain('mejora');
    expect(html).toContain('KPIs de referencia sin línea base declarada no muestran valor');
  });

  it('KPIs del piloto: con línea base declarada, muestra la base y la mejora', () => {
    const html = pintarI(entradaI({ piloto: { lineaBase: { hitosSinIntervencionPct: 50, minutosGpsRegistro: 20 } } }));
    expect(html).toContain('base 50 %');
    expect(html).toContain('base 20 min');
    expect(html).toContain('mejora');
  });

  it('lectura caída: lo dice, no pinta ceros', () => {
    const html = renderToStaticMarkup(<TarjetaInsights insights={null} dias={7} />);
    expect(html).toContain('No se pudieron leer los insights');
    expect(html).not.toContain('Qué pasó');
  });
});
