import { describe, expect, it } from 'vitest';
import { construirProgramaSinteticoConOraculo } from './fixtures';
import { leerProgramaCsv } from './lector';
import { normalizarPrograma } from './normalizar';
import type {
  CambioParaGuardar, FilaGuardada, FilaParaGuardar, NuevaCarga, RepoPrograma,
} from './repo';
import {
  armarLectura, clavesNaturales, huellaDe, sha256Hex, sincronizarPrograma,
  type FilaConBloque, type LecturaPrograma,
} from './sincronizar';

// Un repo en memoria con las garantías que da la base: llave única de carga (el reclamo es atómico),
// identidad de fila por (flota, terminal, clave) y aislamiento por flota. Cuenta las escrituras.

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';

interface FilaDb extends FilaGuardada { tenant: string; terminal: string; fecha: string; primeraVez: string; ultimaVez: string; comentarios: string | null; linea: string | null }

function repoEnMemoria() {
  const cargas = new Map<string, { id: string; tenant: string; nueva: NuevaCarga; orden: number }>();
  const filas = new Map<string, FilaDb>();
  const cambios: Array<CambioParaGuardar & { tenant: string }> = [];
  const log = { escrituras: 0, lecturas: 0, descartes: 0, reabiertas: 0, restauradas: 0 };
  let seq = 0;
  let fallarEn: 'insertar' | 'actualizar' | null = null;

  const repo: RepoPrograma = {
    async registrarCarga(tenantId, c) {
      const k = `${tenantId}|${c.terminal}|${c.archivoSha256}`;
      if (cargas.has(k)) { await Promise.resolve(); return null; }
      const id = `carga-${++seq}`;
      cargas.set(k, { id, tenant: tenantId, nueva: c, orden: ++seq });
      log.escrituras++;
      await Promise.resolve();
      return { id };
    },
    async reabrirCargaSiNoEsUltima(tenantId, terminal, sha) {
      const deTerminal = [...cargas.values()].filter((v) => v.tenant === tenantId && v.nueva.terminal === terminal)
        .sort((a, b) => b.orden - a.orden);
      const propia = deTerminal.find((v) => v.nueva.archivoSha256 === sha);
      if (!propia || deTerminal[0] === propia) return null;
      const creadaAnterior = `orden-${propia.orden}`;
      propia.orden = ++seq;
      log.reabiertas++;
      return { id: propia.id, creadaAnterior };
    },
    async restaurarCarga(tenantId, cargaId, creadaAnterior) {
      const v = [...cargas.values()].find((c) => c.tenant === tenantId && c.id === cargaId);
      if (v) v.orden = Number(creadaAnterior.replace('orden-', ''));
      log.restauradas++;
    },
    async descartarCarga(tenantId, cargaId) {
      for (const [k, v] of cargas) if (v.tenant === tenantId && v.id === cargaId) cargas.delete(k);
      log.descartes++;
    },
    async filasEnRango(tenantId, terminal, desde, hasta) {
      log.lecturas++;
      return [...filas.values()].filter((f) => f.tenant === tenantId && f.terminal === terminal && f.fecha >= desde && f.fecha <= hasta)
        .map((f) => ({ ...f }));
    },
    async insertarFilas(tenantId, nuevas: FilaParaGuardar[]) {
      if (fallarEn === 'insertar') throw new Error('base caída');
      for (const f of nuevas) {
        log.escrituras++;
        filas.set(`${tenantId}|${f.terminal}|${f.claveNatural}`, {
          id: `fila-${++seq}`, tenant: tenantId, terminal: f.terminal, fecha: f.fecha, claveNatural: f.claveNatural,
          cliente: f.cliente, consignatario: f.consignatario, caja: f.caja, unidad: f.unidad, citaEn: f.citaEn, citaTexto: f.citaTexto,
          transito: f.transito, ccp: f.ccp, huella: f.huella, visible: true, primeraVez: f.vistaEn, ultimaVez: f.vistaEn,
          comentarios: f.comentarios, linea: f.linea,
        });
      }
    },
    async actualizarFilas(tenantId, existentes: FilaParaGuardar[]) {
      if (fallarEn === 'actualizar') throw new Error('base caída');
      for (const f of existentes) {
        log.escrituras++;
        const k = `${tenantId}|${f.terminal}|${f.claveNatural}`;
        const previa = filas.get(k);
        if (!previa) throw new Error('actualizar una fila inexistente');
        filas.set(k, {
          ...previa, cliente: f.cliente, consignatario: f.consignatario, caja: f.caja, unidad: f.unidad, citaEn: f.citaEn,
          citaTexto: f.citaTexto, transito: f.transito, ccp: f.ccp, huella: f.huella, visible: true, ultimaVez: f.vistaEn,
          comentarios: f.comentarios, linea: f.linea,
        });
      }
    },
    async registrarCambios(tenantId, nuevos) {
      for (const c of nuevos) { log.escrituras++; cambios.push({ ...c, tenant: tenantId }); }
    },
    async ocultarFilas(tenantId, ids) {
      for (const f of filas.values()) if (f.tenant === tenantId && ids.includes(f.id)) { log.escrituras++; f.visible = false; }
    },
  };
  return { repo, cargas, filas, cambios, log, fallar: (donde: 'insertar' | 'actualizar' | null) => { fallarEn = donde; } };
}

function fila(num: number | null, extra: Partial<FilaConBloque> = {}): FilaConBloque {
  return {
    lineaCsv: 10 + (num ?? 0), fecha: '2026-10-05', tipo: 'EXPORTACION', num, ruta: { origen: 'NLD', destino: 'GDL', tramos: null },
    cliente: 'CLI-A', consignatario: 'CON-A', linea: 'LNX', caja: `ZC${num}`, unidad: `TC${num}`,
    citaEn: '2026-10-05T08:00:00-06:00', citaTexto: null, zonaHoraria: 'America/Mexico_City', transito: 'patio_nld', ccp: 'listo',
    reque: null, comentarios: null, comentarios2: null, avisos: [], bloque: null, ...extra,
  };
}

function lectura(filas: FilaConBloque[], semilla = 'a'): LecturaPrograma {
  return { sha256: sha256Hex(`${semilla}:${JSON.stringify(filas)}`), origen: 'subida', filasLeidas: filas.length, filas };
}

const AHORA = () => new Date('2026-10-05T12:00:00Z');

describe('sincronizarPrograma · primera carga y repetición', () => {
  it('la primera carga deja todas las filas como nuevas y no registra cambios', async () => {
    const m = repoEnMemoria();
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2), fila(3)]), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ yaCargado: false, nuevas: 3, cambiadas: 0, sinCambio: 0, desaparecidas: 0 });
    expect(m.filas.size).toBe(3);
    expect(m.cambios).toHaveLength(0);
  });

  it('una subida idéntica (mismo sha) responde «ya estaba cargado» con CERO escrituras y sin leer', async () => {
    const m = repoEnMemoria();
    const l = lectura([fila(1), fila(2)]);
    await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    const antes = { ...m.log };
    const r = await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ yaCargado: true, nuevas: 0, cambiadas: 0, sinCambio: 0, desaparecidas: 0 });
    expect(m.log.escrituras).toBe(antes.escrituras);
    expect(m.log.lecturas).toBe(antes.lecturas);
  });

  it('A37-A4-01: A → B → A (mismo sha que una carga vieja) SÍ se aplica y registra el regreso', async () => {
    const m = repoEnMemoria();
    const a = lectura([fila(1, { caja: 'ZCA' })], 'a');
    const b = lectura([fila(1, { caja: 'ZCB' })], 'b');
    await sincronizarPrograma(T1, 'GDL', a, { repo: m.repo, ahora: AHORA });
    await sincronizarPrograma(T1, 'GDL', b, { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', a, { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ yaCargado: false, cambiadas: 1 });
    expect([...m.filas.values()][0].caja).toBe('ZCA');
    expect(m.cambios.at(-1)).toMatchObject({ campo: 'caja', antes: 'ZCB', despues: 'ZCA' });
    // y repetirlo ahora sí es «ya cargado»: A es otra vez la última.
    const otra = await sincronizarPrograma(T1, 'GDL', a, { repo: m.repo, ahora: AHORA });
    expect(otra.yaCargado).toBe(true);
  });

  it('A37-A4-01: si la reapertura falla a medias se restaura la carga (no se borra ni queda «última»)', async () => {
    const m = repoEnMemoria();
    const a = lectura([fila(1, { caja: 'ZCA' })], 'a');
    const b = lectura([fila(1, { caja: 'ZCB' })], 'b');
    await sincronizarPrograma(T1, 'GDL', a, { repo: m.repo, ahora: AHORA });
    await sincronizarPrograma(T1, 'GDL', b, { repo: m.repo, ahora: AHORA });
    m.fallar('actualizar');
    await expect(sincronizarPrograma(T1, 'GDL', a, { repo: m.repo, ahora: AHORA })).rejects.toThrow('base caída');
    expect(m.log.restauradas).toBe(1);
    expect(m.log.descartes).toBe(0);
    m.fallar(null);
    const reintento = await sincronizarPrograma(T1, 'GDL', a, { repo: m.repo, ahora: AHORA });
    expect(reintento.yaCargado).toBe(false);
  });

  it('el mismo sha en otra terminal o en otra flota SÍ entra', async () => {
    const m = repoEnMemoria();
    const l = lectura([fila(1)]);
    await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    const otraTerminal = await sincronizarPrograma(T1, 'MTY', l, { repo: m.repo, ahora: AHORA });
    const otraFlota = await sincronizarPrograma(T2, 'GDL', l, { repo: m.repo, ahora: AHORA });
    expect(otraTerminal.yaCargado).toBe(false);
    expect(otraFlota.yaCargado).toBe(false);
    expect(m.filas.size).toBe(3);
  });

  it('dos cargas concurrentes del mismo archivo: una gana, la otra recibe «ya estaba cargado»', async () => {
    const m = repoEnMemoria();
    const l = lectura([fila(1), fila(2), fila(3)]);
    const [a, b] = await Promise.all([
      sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA }),
      sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA }),
    ]);
    expect([a.yaCargado, b.yaCargado].sort()).toEqual([false, true]);
    expect(m.filas.size).toBe(3);
    expect(m.cambios).toHaveLength(0);
  });

  it('cambiar de archivo sin que cambie nada de las filas: todo sinCambio, cero líneas de cambio', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2)], 'a'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2)], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ yaCargado: false, nuevas: 0, cambiadas: 0, sinCambio: 2, desaparecidas: 0 });
    expect(m.cambios).toHaveLength(0);
  });
});

describe('sincronizarPrograma · detección de cambios', () => {
  it('cambio de UNIDAD en una fila = una fila de cambio con antes y después', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2)], 'a'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2, { unidad: 'TC999' })], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ nuevas: 0, cambiadas: 1, sinCambio: 1, camposCambiados: 1 });
    expect(m.cambios).toHaveLength(1);
    expect(m.cambios[0]).toMatchObject({ campo: 'unidad', antes: 'TC2', despues: 'TC999', tenant: T1 });
    expect([...m.filas.values()].find((f) => f.claveNatural.endsWith('|2'))?.unidad).toBe('TC999');
  });

  it('cada campo vigilado se registra; la fila con varios cambios deja una línea por campo', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'a'), { repo: m.repo, ahora: AHORA });
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1, {
      caja: 'ZC77', unidad: null, ccp: 'pend_ccp', transito: 'en_ruta', citaEn: '2026-10-05T10:30:00-06:00',
      consignatario: 'CON-B', cliente: 'CLI-B',
    })], 'b'), { repo: m.repo, ahora: AHORA });
    expect(m.cambios.map((c) => c.campo).sort()).toEqual(['caja', 'ccp', 'cita_en', 'cliente', 'consignatario', 'transito', 'unidad']);
    const unidad = m.cambios.find((c) => c.campo === 'unidad');
    expect(unidad).toMatchObject({ antes: 'TC1', despues: null });
  });

  it('la misma cita con otro desfase (la base devuelve +00:00) NO es un cambio', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'a'), { repo: m.repo, ahora: AHORA });
    for (const f of m.filas.values()) f.citaEn = '2026-10-05T14:00:00+00:00'; // = 08:00-06:00
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ cambiadas: 0, sinCambio: 1 });
    expect(m.cambios).toHaveLength(0);
  });

  it('un cambio solo en comentarios o línea no es un cambio vigilado, pero la fila queda al día', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'a'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1, { comentarios: 'sin novedad', linea: 'LNZ' })], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ cambiadas: 0, sinCambio: 1 });
    expect(m.cambios).toHaveLength(0);
    const f = [...m.filas.values()][0];
    expect([f.comentarios, f.linea]).toEqual(['sin novedad', 'LNZ']);
  });

  it('reordenar filas dentro de la sección no genera cambios (la clave es el «#»)', async () => {
    const m = repoEnMemoria();
    const filas = [fila(1), fila(2), fila(3), fila(4)];
    await sincronizarPrograma(T1, 'GDL', lectura(filas, 'a'), { repo: m.repo, ahora: AHORA });
    const reordenadas = [filas[3], filas[1], filas[0], filas[2]].map((f, i) => ({ ...f, lineaCsv: 500 + i }));
    const r = await sincronizarPrograma(T1, 'GDL', lectura(reordenadas, 'b'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ nuevas: 0, cambiadas: 0, sinCambio: 4, desaparecidas: 0 });
    expect(m.cambios).toHaveLength(0);
  });

  it('fila desaparecida = visible=false, con línea de cambio, y no se borra', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2), fila(3)], 'a'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(3)], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ desaparecidas: 1, sinCambio: 2 });
    expect(m.filas.size).toBe(3);
    const oculta = [...m.filas.values()].find((f) => f.claveNatural.endsWith('|2'));
    expect(oculta?.visible).toBe(false);
    expect(m.cambios).toEqual([expect.objectContaining({ campo: 'visible', antes: 'true', despues: 'false' })]);
  });

  it('una fila ya oculta que sigue sin venir no se vuelve a contar ni a registrar', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2)], 'a'), { repo: m.repo, ahora: AHORA });
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'b'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'c'), { repo: m.repo, ahora: AHORA });
    expect(r.desaparecidas).toBe(0);
    expect(m.cambios).toHaveLength(1);
  });

  it('una fila oculta que reaparece vuelve a visible y deja su línea de cambio', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2)], 'a'), { repo: m.repo, ahora: AHORA });
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'b'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2)], 'c'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ cambiadas: 1, sinCambio: 1, nuevas: 0 });
    expect([...m.filas.values()].every((f) => f.visible)).toBe(true);
    expect(m.cambios.at(-1)).toMatchObject({ campo: 'visible', antes: 'false', despues: 'true' });
  });

  it('los días que el archivo ya no cubre (más viejos o más nuevos) no se ocultan', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([
      fila(1, { fecha: '2026-10-05' }), fila(1, { fecha: '2026-10-06' }), fila(1, { fecha: '2026-10-07' }),
    ], 'a'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1, { fecha: '2026-10-06' }), fila(1, { fecha: '2026-10-07' })], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r.desaparecidas).toBe(0);
    expect([...m.filas.values()].every((f) => f.visible)).toBe(true);
  });

  it('un día en medio del rango que el archivo ya no trae SÍ se oculta', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([
      fila(1, { fecha: '2026-10-05' }), fila(1, { fecha: '2026-10-06' }), fila(1, { fecha: '2026-10-07' }),
    ], 'a'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1, { fecha: '2026-10-05' }), fila(1, { fecha: '2026-10-07' })], 'b'), { repo: m.repo, ahora: AHORA });
    expect(r.desaparecidas).toBe(1);
  });

  it('las filas de otra flota o de otra terminal no se tocan', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T2, 'GDL', lectura([fila(1), fila(2)], 'x'), { repo: m.repo, ahora: AHORA });
    await sincronizarPrograma(T1, 'MTY', lectura([fila(1), fila(2)], 'y'), { repo: m.repo, ahora: AHORA });
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1, { unidad: 'TC500' })], 'z'), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ nuevas: 1, desaparecidas: 0 });
    expect([...m.filas.values()].filter((f) => f.visible)).toHaveLength(5);
    expect(m.cambios).toHaveLength(0);
  });
});

describe('sincronizarPrograma · claves y datos incompletos', () => {
  it('sin «#» la clave cae a la caja, luego a la unidad y por último a la línea del archivo', () => {
    const { claves } = clavesNaturales([
      fila(null, { caja: 'ZC9' }), fila(null, { caja: null, unidad: 'TC9' }), fila(null, { caja: null, unidad: null, lineaCsv: 77 }),
    ]);
    expect(claves).toEqual(['2026-10-05|EXPORTACION||c:ZC9', '2026-10-05|EXPORTACION||u:TC9', '2026-10-05|EXPORTACION||l:77']);
  });

  it('el bloque (ruta de Doméstico/Mov. vacío) separa claves iguales de secciones distintas', () => {
    const { claves } = clavesNaturales([fila(1, { tipo: 'DOMESTICO', bloque: 'GDL-MTY' }), fila(1, { tipo: 'DOMESTICO', bloque: 'GDL-QRO' })]);
    expect(new Set(claves).size).toBe(2);
  });

  it('un «#» repetido dentro del archivo no se pisa: la segunda lleva sufijo y se informa', async () => {
    const m = repoEnMemoria();
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(1, { caja: 'OTRA' })]), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ nuevas: 2, clavesRepetidas: 1 });
    expect(m.filas.size).toBe(2);
  });

  it('una fila sin fecha de sección no se guarda y se cuenta', async () => {
    const m = repoEnMemoria();
    const r = await sincronizarPrograma(T1, 'GDL', lectura([fila(1), fila(2, { fecha: null })]), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ nuevas: 1, sinFecha: 1 });
  });

  it('un archivo sin filas guardables registra la carga y no toca filas', async () => {
    const m = repoEnMemoria();
    const r = await sincronizarPrograma(T1, 'GDL', lectura([]), { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ yaCargado: false, nuevas: 0, desaparecidas: 0 });
    expect(m.filas.size).toBe(0);
  });

  it('rechaza un sha inválido, tenant o terminal vacíos', async () => {
    const m = repoEnMemoria();
    const l = lectura([fila(1)]);
    await expect(sincronizarPrograma(T1, 'GDL', { ...l, sha256: 'no-es-sha' }, { repo: m.repo })).rejects.toThrow(/sha256/);
    await expect(sincronizarPrograma('', 'GDL', l, { repo: m.repo })).rejects.toThrow(/tenant/);
    await expect(sincronizarPrograma(T1, '  ', l, { repo: m.repo })).rejects.toThrow(/terminal/);
  });
});

describe('sincronizarPrograma · fallos', () => {
  it('si falla a medias deshace el reclamo y el reintento SÍ procesa el archivo', async () => {
    const m = repoEnMemoria();
    const l = lectura([fila(1), fila(2)]);
    m.fallar('insertar');
    await expect(sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA })).rejects.toThrow('base caída');
    expect(m.cargas.size).toBe(0);
    expect(m.log.descartes).toBe(1);
    m.fallar(null);
    const r = await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    expect(r).toMatchObject({ yaCargado: false, nuevas: 2 });
  });

  it('un cambio nunca se pierde: se escribe antes que las filas, así que si las filas fallan el reintento lo repite', async () => {
    const m = repoEnMemoria();
    await sincronizarPrograma(T1, 'GDL', lectura([fila(1)], 'a'), { repo: m.repo, ahora: AHORA });
    const l = lectura([fila(1, { unidad: 'TC800' })], 'b');
    m.fallar('actualizar');
    await expect(sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA })).rejects.toThrow('base caída');
    expect(m.cambios).toHaveLength(1);
    m.fallar(null);
    await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    expect([...m.filas.values()][0].unidad).toBe('TC800');
    expect(m.cambios.every((c) => c.campo === 'unidad')).toBe(true);
  });

  it('si el descarte también falla, se lanza el error ORIGINAL', async () => {
    const m = repoEnMemoria();
    m.fallar('insertar');
    m.repo.descartarCarga = async () => { throw new Error('otro fallo'); };
    await expect(sincronizarPrograma(T1, 'GDL', lectura([fila(1)]), { repo: m.repo })).rejects.toThrow('base caída');
  });
});

describe('huella', () => {
  it('es estable y distingue los campos vigilados', () => {
    const base = { caja: 'A', unidad: 'B', ccp: 'listo', transito: 'ok', cita_en: null, cita_texto: null, consignatario: null, cliente: null };
    expect(huellaDe(base)).toBe(huellaDe({ ...base }));
    expect(huellaDe(base)).not.toBe(huellaDe({ ...base, unidad: 'C' }));
    expect(huellaDe(base)).toHaveLength(32);
  });
});

describe('de punta a punta con el fixture sintético (lector → normalizador → sincronizar)', () => {
  it('carga el programa, lo repite sin escribir nada y detecta un cambio de unidad', async () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 3, filasPorSeccion: 12 });
    const lector = leerProgramaCsv(texto, { terminal: 'GDL' });
    const normalizado = normalizarPrograma(lector);
    const l = armarLectura(lector, normalizado, { sha256: sha256Hex(texto), origen: 'subida' });

    expect(l.filas).toHaveLength(normalizado.calidad.validas);
    expect(l.filasLeidas).toBe(normalizado.calidad.leidas);
    expect((l.avisos ?? []).length).toBeLessThanOrEqual(200);

    const m = repoEnMemoria();
    const r1 = await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    expect(r1.nuevas).toBe(l.filas.length - r1.sinFecha);
    expect(r1.sinFecha).toBe(0);
    expect(m.filas.size).toBe(r1.nuevas);

    const escrituras = m.log.escrituras;
    const r2 = await sincronizarPrograma(T1, 'GDL', l, { repo: m.repo, ahora: AHORA });
    expect(r2.yaCargado).toBe(true);
    expect(m.log.escrituras).toBe(escrituras);

    const idx = l.filas.findIndex((f) => f.unidad !== null);
    const filas2 = l.filas.map((f, i) => (i === idx ? { ...f, unidad: 'TCNUEVA' } : f));
    const r3 = await sincronizarPrograma(T1, 'GDL', { ...l, filas: filas2, sha256: sha256Hex(`${texto}!`) }, { repo: m.repo, ahora: AHORA });
    expect(r3).toMatchObject({ nuevas: 0, cambiadas: 1, desaparecidas: 0, camposCambiados: 1 });
    expect(m.cambios).toHaveLength(1);
    expect(m.cambios[0].campo).toBe('unidad');
  });

  it('Doméstico y Mov. vacío aportan su ruta como bloque', () => {
    const { texto } = construirProgramaSinteticoConOraculo({ dias: 1, filasPorSeccion: 4 });
    const lector = leerProgramaCsv(texto, { terminal: 'GDL' });
    const l = armarLectura(lector, normalizarPrograma(lector), { sha256: sha256Hex(texto), origen: 'drive' });
    const dom = l.filas.filter((f) => f.tipo === 'DOMESTICO');
    expect(dom.length).toBeGreaterThan(0);
    expect(dom.every((f) => f.bloque !== null)).toBe(true);
    expect(l.filas.filter((f) => f.tipo === 'EXPORTACION').every((f) => f.bloque === null)).toBe(true);
    expect(l.origen).toBe('drive');
  });
});
