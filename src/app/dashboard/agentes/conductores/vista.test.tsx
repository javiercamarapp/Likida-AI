import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { BloqueCola, BloqueConteos, type ColaConductores, type ConteosConductores } from './vista';

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
