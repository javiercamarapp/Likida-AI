import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AvisoCorte, BandaCobertura, ChipsFiltro, SelloDato, TablaLista, Tendencia, chipsActivos, estadoDeCorte, haceTiempo, textoSello, tonoTendencia, type ColumnaTabla } from './index';

interface Fila { id: string; folio: string; total: number | null; fecha: string }
const FILAS: Fila[] = [
  { id: 'a', folio: 'V-10', total: 300, fecha: '2026-10-03' },
  { id: 'b', folio: 'V-2', total: null, fecha: '2026-10-01' },
  { id: 'c', folio: 'V-3', total: 1500, fecha: '2026-10-02' },
  { id: 'd', folio: 'V-1', total: 20, fecha: '2026-10-04' },
];
const COLS: ColumnaTabla<Fila>[] = [
  { id: 'folio', titulo: 'Folio', principal: true, celda: (f) => f.folio, valor: (f) => f.folio },
  { id: 'fecha', titulo: 'Fecha', celda: (f) => f.fecha, valor: (f) => f.fecha },
  { id: 'total', titulo: 'Total', alinear: 'der', celda: (f) => (f.total === null ? '—' : String(f.total)), valor: (f) => f.total },
  { id: 'accion', titulo: 'Acción', tituloOculto: true, celda: (f) => <a href={`/x/${f.id}`}>Ver</a> },
];
const base = { etiqueta: 'Viajes', columnas: COLS, idFila: (f: Fila) => f.id, base: '/dashboard/viajes' };
const html = (p: Partial<Parameters<typeof TablaLista<Fila>>[0]> = {}) => renderToStaticMarkup(<TablaLista<Fila> {...base} filas={FILAS} params={{}} {...p} />);
/** El texto de un fragmento: une sus nodos de texto (lo que queda entre «>» y «<»), sin «limpiar» etiquetas con reemplazos. */
const texto = (fragmento: string) => [...fragmento.matchAll(/>([^<>]+)</g)].map((m) => m[1]).join('');
const folios = (h: string) => [...h.matchAll(/<th scope="row"[^>]*>([\s\S]*?)<\/th>/g)].map((m) => texto(`>${m[1]}<`));

describe('TablaLista · semántica accesible', () => {
  it('caption, scope=col en cabeceras, scope=row en la columna principal y región con foco', () => {
    const h = html();
    expect(h).toContain('<caption');
    expect(h).toMatch(/<caption[^>]*>Viajes/);
    expect(h.match(/<th scope="col"/g)?.length).toBe(COLS.length);
    expect(folios(h)).toEqual(['V-10', 'V-2', 'V-3', 'V-1']);
    expect(h).toContain('role="region"');
    expect(h).toContain('tabindex="0"');
    expect(h).toMatch(/aria-labelledby="[^"]+"/);
  });
  it('sin orden="local" NINGUNA cabecera ofrece ordenar (ordenar solo la página visible fingiría ordenar el total)', () => {
    const h = html();
    expect(h).not.toContain('aria-sort');
    expect(h).not.toContain('rv-tl__orden');
    expect(folios(h)).toEqual(['V-10', 'V-2', 'V-3', 'V-1']); // el orden del servidor se respeta
  });
  it('la columna de acciones tiene título leíble pero oculto', () => {
    expect(html()).toContain('<span class="rv-sr">Acción</span>');
  });
  it('cada celda lleva su rótulo para la tarjeta-fila de móvil', () => {
    expect(html()).toContain('data-etq="Total"');
  });
});

describe('TablaLista · orden por URL', () => {
  it('orden="local": las columnas con `valor` son enlaces con aria-sort y el resto no', () => {
    const h = html({ orden: 'local' });
    expect(h.match(/aria-sort="none"/g)?.length).toBe(3);
    expect(h).toMatch(/<th scope="col" class="rv-tl__th"><span class="rv-sr">Acción<\/span><\/th>/); // la columna de acciones no se ordena
  });
  it('?orden=total&dir=desc ordena de verdad (los sin dato al final) y marca descending', () => {
    const h = html({ orden: 'local', params: { orden: 'total', dir: 'desc' } });
    expect(folios(h)).toEqual(['V-3', 'V-10', 'V-1', 'V-2']);
    expect(h).toContain('aria-sort="descending"');
    expect(h).toMatch(/Ordenada por Total, de mayor a menor/);
  });
  it('ascendente: V-2 (sin total) sigue al final, y el texto V-1 < V-2 < V-3 < V-10 en la columna folio', () => {
    expect(folios(html({ orden: 'local', params: { orden: 'total', dir: 'asc' } }))).toEqual(['V-1', 'V-10', 'V-3', 'V-2']);
    expect(folios(html({ orden: 'local', params: { orden: 'folio', dir: 'asc' } }))).toEqual(['V-1', 'V-2', 'V-3', 'V-10']);
  });
  it('los enlaces de cabecera conservan tenant y filtros, resetean la página y siguen el ciclo asc → desc → quitar', () => {
    const h = html({ orden: 'local', params: { tenant: 'T1', f: 'abiertos', pag: '2' }, paginacion: { tamano: 2 } });
    const hrefs = [...h.matchAll(/class="rv-tl__orden"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*class="rv-tl__orden"/g)].map((m) => (m[1] ?? m[2]).replace(/&amp;/g, '&'));
    expect(hrefs.length).toBe(3);
    for (const href of hrefs) {
      const q = new URL(href, 'https://x').searchParams;
      expect(q.get('tenant')).toBe('T1');
      expect(q.get('f')).toBe('abiertos');
      expect(q.get('pag')).toBeNull();
      expect(q.get('dir')).toBe('asc');
    }
    const desc = html({ orden: 'local', params: { orden: 'fecha', dir: 'asc' } });
    expect(desc).toMatch(/Ordenar de mayor a menor/);
    const quitar = html({ orden: 'local', params: { orden: 'fecha', dir: 'desc' } });
    expect(quitar).toMatch(/Quitar el orden/);
  });
  it('una columna inventada en la URL se ignora (el orden por omisión manda)', () => {
    expect(folios(html({ orden: 'local', params: { orden: 'constraseña', dir: 'desc' } }))).toEqual(['V-10', 'V-2', 'V-3', 'V-1']);
  });
  it('orden inicial: sin parámetros ya sale ordenada y marcada', () => {
    const h = html({ orden: { inicial: { orden: 'fecha', dir: 'desc' } } });
    expect(folios(h)).toEqual(['V-1', 'V-10', 'V-3', 'V-2']);
    expect(h).toContain('aria-sort="descending"');
  });
});

describe('TablaLista · paginación por URL', () => {
  const muchas: Fila[] = Array.from({ length: 23 }, (_, i) => ({ id: `i${i}`, folio: `F-${String(i + 1).padStart(2, '0')}`, total: i, fecha: '2026-10-01' }));
  it('página 1 de 3: 10 filas, rango, siguiente y enlaces con aria-current', () => {
    const h = html({ filas: muchas, paginacion: { tamano: 10 } });
    expect(folios(h).length).toBe(10);
    expect(h).toContain('1–10 de 23');
    expect(h).toMatch(/aria-current="page"[^>]*>1</);
    expect(h).toContain('rel="next"');
    expect(h).not.toContain('rel="prev"');
  });
  it('?pag=3 trae la última (3 filas) y ofrece anterior; el enlace conserva el resto de la query', () => {
    const h = html({ filas: muchas, paginacion: { tamano: 10 }, params: { pag: '3', tenant: 'T1' } });
    expect(folios(h)).toEqual(['F-21', 'F-22', 'F-23']);
    expect(h).toContain('21–23 de 23');
    expect(h).toContain('rel="prev"');
    expect(h).not.toContain('rel="next"');
    expect(h).toContain('tenant=T1');
  });
  it('una página fuera de rango cae a la última y orden + página trabajan juntos', () => {
    expect(folios(html({ filas: muchas, paginacion: { tamano: 10 }, params: { pag: '99' } })).length).toBe(3);
    const h = html({ filas: muchas, orden: 'local', paginacion: { tamano: 10 }, params: { orden: 'total', dir: 'desc', pag: '2' } });
    expect(folios(h)[0]).toBe('F-13');
  });
  it('con una sola página no hay navegación, solo el conteo', () => {
    const h = html({ paginacion: { tamano: 25 } });
    expect(h).not.toContain('rv-tl__paginas');
    expect(h).toContain('4 filas');
  });
});

describe('TablaLista · estados con las primitivas del producto', () => {
  it('vacío: título + línea + UNA acción', () => {
    const h = html({ filas: [], vacio: { titulo: 'Sin viajes', texto: 'Cuando despaches uno aparece aquí.', accion: <a href="/despacho">Ir a Despacho</a> } });
    expect(h).toContain('rv-vacio');
    expect(h).toContain('Sin viajes');
    expect(h).toContain('Ir a Despacho');
    expect(h).not.toContain('<table');
  });
  it('error: «No disponible ahora» + «No es cero», nunca una tabla vacía ni ceros', () => {
    const h = html({ estado: 'error', filas: [] });
    expect(h).toContain('role="alert"');
    expect(h).toMatch(/No disponible ahora\. No es cero/);
    expect(h).not.toContain('<table');
  });
  it('cargando: esqueleto con forma de tabla, sin tabla real', () => {
    const h = html({ estado: 'cargando', filas: [] });
    expect(h).toContain('rv-esq-tabla');
    expect(h).not.toContain('<table');
  });
});

describe('TablaLista · selección opcional', () => {
  it('casillas con name/value/form, etiqueta accesible por fila y «seleccionar todas»', () => {
    const h = html({ seleccion: { nombre: 'ids', form: 'masiva', idFila: (f) => f.id, etiquetaFila: (f) => `Seleccionar ${f.folio}`, singular: 'seleccionada', plural: 'seleccionadas' } });
    expect(h.match(/name="ids"/g)?.length).toBe(4);
    expect(h).toContain('form="masiva"');
    expect(h).toContain('value="a"');
    expect(h).toContain('aria-label="Seleccionar V-10"');
    expect(h).toContain('data-sel-todas');
    expect(h).toContain('aria-live="polite"');
  });
  it('sin seleccion no hay casillas', () => {
    expect(html()).not.toContain('type="checkbox"');
  });
});

describe('TablaLista · CSP', () => {
  it('no emite style= ni <style>', () => {
    const h = html({ orden: 'local', paginacion: { tamano: 2 }, seleccion: { nombre: 'ids', form: 'f', idFila: (f) => f.id, etiquetaFila: (f) => f.folio, singular: 's', plural: 'p' } });
    expect(h).not.toMatch(/\sstyle=/);
    expect(h).not.toContain('<style');
  });
});

describe('SelloDato · la fecha de lectura nunca se presenta como corte', () => {
  const AHORA = Date.parse('2026-10-31T18:00:00Z');
  it('con corte real: «Fuente · corte 28 oct 2026»', () => {
    const t = textoSello({ fuente: 'TMS', corte: '2026-10-28', ahora: AHORA });
    expect(t.texto).toBe('TMS · corte 28 oct 2026');
  });
  it('sin corte: dice «leído», NUNCA «corte», y la ayuda lo aclara', () => {
    const t = textoSello({ fuente: 'Registro de viajes', leidoEn: '2026-10-31T17:55:00Z', ahora: AHORA });
    expect(t.texto).toBe('Registro de viajes · leído 31 oct 2026');
    expect(t.texto).not.toContain('corte');
    expect(t.ayuda).toMatch(/no informa su fecha de corte/);
    expect(t.actualizado).toBe('hace 5 min');
  });
  it('sin corte ni lectura: solo la fuente, sin inventar fecha', () => {
    const t = textoSello({ fuente: 'Casetas', ahora: AHORA });
    expect(t).toEqual({ texto: 'Casetas', ayuda: 'La fuente no informa su fecha de corte.', actualizado: null });
  });
  it('una fecha sin hora no se corre un día', () => {
    expect(textoSello({ fuente: 'X', corte: '2026-07-01', ahora: AHORA }).texto).toBe('X · corte 01 jul 2026');
  });
  it('haceTiempo', () => {
    expect(haceTiempo(AHORA - 20_000, AHORA)).toBe('hace unos segundos');
    expect(haceTiempo(AHORA - 59 * 60_000, AHORA)).toBe('hace 59 min');
    expect(haceTiempo(AHORA - 5 * 3_600_000, AHORA)).toBe('hace 5 h');
    expect(haceTiempo(AHORA - 86_400_000, AHORA)).toBe('hace 1 día');
    expect(haceTiempo(AHORA - 3 * 86_400_000, AHORA)).toBe('hace 3 días');
    expect(haceTiempo(AHORA + 3_600_000, AHORA)).toBeNull(); // futuro: no inventa antigüedad
  });
  it('clases de dato: observado es un punto silencioso; estimado, inferido y sin dato llevan su marca con texto', () => {
    const h = (tipo: 'observado' | 'estimado' | 'inferido' | 'sin_dato') => renderToStaticMarkup(<SelloDato tipo={tipo} fuente="TMS" corte="2026-10-28" ahora={AHORA} />);
    expect(h('observado')).toContain('rv-sello__punto');
    expect(h('observado')).not.toContain('rv-kind');
    for (const [tipo, rotulo] of [['estimado', 'Estimado'], ['inferido', 'Inferido'], ['sin_dato', 'Sin dato']] as const) {
      expect(h(tipo)).toContain('rv-kind');
      expect(h(tipo)).toContain(rotulo);
    }
    expect(h('observado')).toContain('<time class="rv-sello__texto" dateTime="2026-10-28">');
  });
  it('«actualizado hace» solo si se sabe cuándo se leyó', () => {
    expect(renderToStaticMarkup(<SelloDato tipo="observado" fuente="TMS" corte="2026-10-28" leidoEn="2026-10-31T17:00:00Z" ahora={AHORA} />)).toContain('actualizado hace 1 h');
    expect(renderToStaticMarkup(<SelloDato tipo="observado" fuente="TMS" corte="2026-10-28" ahora={AHORA} />)).not.toContain('actualizado');
  });
});

describe('AvisoCorte', () => {
  const AHORA = Date.parse('2026-10-31T18:00:00Z');
  it('estadoDeCorte: al día, obsoleto, parcial y desconocido (un corte ausente nunca es «al día»)', () => {
    expect(estadoDeCorte({ corte: '2026-10-31', ahora: AHORA })).toBe('al_dia');
    expect(estadoDeCorte({ corte: '2026-10-20', ahora: AHORA })).toBe('obsoleto');
    expect(estadoDeCorte({ corte: '2026-10-31', ahora: AHORA, leidas: 18, total: 22 })).toBe('parcial');
    expect(estadoDeCorte({ ahora: AHORA })).toBe('desconocido');
    expect(estadoDeCorte({ corte: 'basura', ahora: AHORA })).toBe('desconocido');
  });
  it('tres tonos con icono + texto + <time>, y la cobertura «18 de 22 operadores con captura»', () => {
    const h = renderToStaticMarkup(<AvisoCorte fuente="Registro de jornada" corte="2026-10-31" leidas={18} total={22} rotuloUnidad="operadores con captura" ahora={AHORA} />);
    expect(h).toContain('data-estado="parcial"');
    expect(h).toContain('Datos parciales.');
    expect(h).toContain('18 de 22 operadores con captura.');
    expect(h).toContain('<time dateTime="2026-10-31">31 oct 2026</time>');
    expect(h).toContain('<svg');
    expect(renderToStaticMarkup(<AvisoCorte fuente="TMS" corte="2026-10-10" ahora={AHORA} />)).toContain('Datos desactualizados.');
    expect(renderToStaticMarkup(<AvisoCorte fuente="TMS" ahora={AHORA} />)).toContain('TMS no informa su fecha de corte.');
  });
});

describe('BandaCobertura · los fallos se ven', () => {
  it('«Fuentes 5 de 7», los 2 fallos por nombre con su motivo y la advertencia «No es cero»', () => {
    const fuentes = [
      ...['TMS', 'GPS', 'Casetas', 'Combustible', 'Nómina'].map((nombre) => ({ nombre, estado: 'ok' as const })),
      { nombre: 'SAT', estado: 'fallo' as const, motivo: 'no respondió' },
      { nombre: 'Buzón', estado: 'fallo' as const },
    ];
    const h = renderToStaticMarkup(<BandaCobertura fuentes={fuentes} />);
    expect(h).toContain('<strong>5 de 7</strong>');
    expect(h).toContain('SAT');
    expect(h).toContain('no se pudo leer: no respondió');
    expect(h).toContain('no se pudo leer');
    expect(h).toContain('No es cero');
    expect(h).toContain('data-estado="fallo"');
    expect(h).not.toContain('data-completa');
  });
  it('completa: sin advertencia; sin fuentes: no pinta nada; sin datos no es fallo', () => {
    const h = renderToStaticMarkup(<BandaCobertura fuentes={[{ nombre: 'TMS', estado: 'ok' }, { nombre: 'GPS', estado: 'sin_datos' }]} />);
    expect(h).toContain('<strong>2 de 2</strong> leídas');
    expect(h).not.toContain('No es cero');
    expect(renderToStaticMarkup(<BandaCobertura fuentes={[]} />)).toBe('');
  });
});

describe('ChipsFiltro · filtros activos en la URL', () => {
  const defs = [
    { param: 'f', etiqueta: 'Estado', omitir: ['todos'], rotuloValor: (v: string) => v.charAt(0).toUpperCase() + v.slice(1) },
    { param: 'q', etiqueta: 'Búsqueda' },
  ];
  it('un chip por filtro activo; «todos» y vacío no generan chip', () => {
    expect(chipsActivos('/dashboard/viajes', { f: 'todos', q: '' }, defs)).toEqual([]);
    const c = chipsActivos('/dashboard/viajes', { f: 'abiertos', q: ' V-10 ', tenant: 'T1' }, defs);
    expect(c.map((x) => [x.etiqueta, x.valor])).toEqual([['Estado', 'Abiertos'], ['Búsqueda', 'V-10']]);
  });
  it('quitar un chip conserva los demás filtros y el tenant, y vuelve a la primera página (c / cursor / pag / p)', () => {
    const [estado] = chipsActivos('/dashboard/viajes', { f: 'abiertos', q: 'V-10', tenant: 'T1', c: 'CURSOR', pag: '3' }, defs);
    const q = new URL(estado.quitarHref, 'https://x').searchParams;
    expect(Object.fromEntries(q)).toEqual({ q: 'V-10', tenant: 'T1' });
  });
  it('el marcado: grupo con nombre, ✕ con nombre accesible que dice qué quita, «Quitar todos» solo con 2 o más', () => {
    const chips = chipsActivos('/dashboard/viajes', { f: 'abiertos', q: 'V-10' }, defs);
    const h = renderToStaticMarkup(<ChipsFiltro chips={chips} quitarTodosHref="/dashboard/viajes" />);
    expect(h).toContain('role="group"');
    expect(h).toContain('aria-label="Filtros activos"');
    expect(h).toContain('aria-label="Quitar el filtro Estado: Abiertos"');
    expect(h).toContain('Quitar todos');
    const uno = renderToStaticMarkup(<ChipsFiltro chips={chips.slice(0, 1)} quitarTodosHref="/dashboard/viajes" />);
    expect(uno).not.toContain('Quitar todos');
    expect(renderToStaticMarkup(<ChipsFiltro chips={[]} />)).toBe('');
  });
});

describe('Tendencia · `bueno` decide el color, no el signo', () => {
  it('subir es malo (horas de deuda): una subida es «bad»; bajar es «ok»', () => {
    expect(tonoTendencia(12, 'baja')).toBe('bad');
    expect(tonoTendencia(-12, 'baja')).toBe('ok');
  });
  it('subir es bueno (ingresos): al revés', () => {
    expect(tonoTendencia(12, 'sube')).toBe('ok');
    expect(tonoTendencia(-12, 'sube')).toBe('bad');
  });
  it('sin `bueno`, cero, nulo o NaN: neutral (no se juzga lo que no se sabe)', () => {
    expect(tonoTendencia(12)).toBe('neutral');
    expect(tonoTendencia(0, 'sube')).toBe('neutral');
    expect(tonoTendencia(null, 'sube')).toBe('neutral');
    expect(tonoTendencia(NaN, 'sube')).toBe('neutral');
  });
  it('el marcado lleva flecha + signo + texto para lectores; nulo dice «sin periodo comparable», nunca 0 %', () => {
    const h = renderToStaticMarkup(<Tendencia valor={12.34} bueno="baja" contra="vs mes anterior" />);
    expect(h).toContain('data-tono="bad"');
    expect(h).toContain('▲');
    expect(h).toContain('+12.3%');
    expect(h).toContain('vs mes anterior');
    expect(h).toContain('(sube; mala noticia)');
    expect(renderToStaticMarkup(<Tendencia valor={-3} bueno="baja" />)).toContain('−3%');
    const nulo = renderToStaticMarkup(<Tendencia valor={null} bueno="sube" />);
    expect(nulo).toContain('sin periodo comparable');
    expect(nulo).not.toContain('0%');
  });
});
