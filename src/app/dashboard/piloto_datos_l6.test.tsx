import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { VistaViajes, type FilaRegistroViaje } from './viajes/vista';
import { VistaAgenteProveedores } from './agentes/proveedores/vista';
import { SeccionCola, chipsDeCola } from './agentes/liquidacion/cola';
import { SIN_FILTROS, type FilaCola, type PaginaCola } from '@/lib/likida/revision';
import type { FacturaProveedor } from '@/lib/likida/proveedores';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }), usePathname: () => '/dashboard' }));

// LOTE L6 · PILOTOS: Viajes, Cola de liquidaciones y Bandeja de proveedores pasan a `TablaLista` + `SelloDato` + `ChipsFiltro`
// SIN perder ninguna función, filtro, acción, permiso ni dato. Estas pruebas fijan, sobre el render real, lo que la pantalla de antes
// ya hacía (columnas, celdas, vínculos, gateo de pesos por rol, filtros, paginación por cursor) y lo nuevo (semántica de tabla,
// sello con fuente y fecha de lectura, chips quitables).

const v = (n: number, extra: Partial<FilaRegistroViaje> = {}): FilaRegistroViaje => ({
  id: `via-${n}`, folio: `V-${n}`, origen: 'Monterrey', destino: 'Querétaro', estatus: 'liquidado', operadorNombre: `Chofer ${n}`, unidadEco: `U-${n}`,
  fechaInicio: '2026-10-20T14:00:00Z', intakePendientes: 0, avisadoEn: null, aceptadoEn: null, escaladoEn: null, avisosEnviados: 0,
  anticipo: 5000, comprobado: 4800, diferencia: 200, liqId: `liq-${n}`, liqEstatus: 'cuadrada', ...extra,
});
const conteos = { total: 120, abiertos: 10, enCuadre: 3, liquidados: 100, escalados: 1 };
const importar = async () => null;
const pintarViajes = (o: Partial<Parameters<typeof VistaViajes>[0]> = {}) => renderToStaticMarkup(
  <VistaViajes filas={[v(1), v(2, { origen: null, destino: null, operadorNombre: null, unidadEco: null, fechaInicio: null, comprobado: null, diferencia: null, liqId: null, estatus: 'abierto' })]}
    filtro="todos" conteos={conteos} sufijo="?tenant=T1" importar={importar} puedeImportar verDinero q="" cursor={null} siguiente={null} hayMas={false} porPagina={50} {...o} />,
);
/** Texto de cada celda: une los nodos de texto (entre «>» y «<») sin «limpiar» etiquetas con reemplazos. */
const celdas = (h: string) => [...h.matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/g)].map((m) => [...`>${m[1]}<`.matchAll(/>([^<>]+)</g)].map((x) => x[1]).join(' ').split(/\s+/).filter(Boolean).join(' '));

describe('Viajes · misma función, tabla accesible', () => {
  it('con dinero: las 10 columnas de antes y todos sus datos', () => {
    const h = pintarViajes();
    for (const t of ['Viaje', 'Operador', 'Unidad', 'Inicio', 'Anticipo', 'Comprobado', 'Diferencia', 'Aviso', 'Estatus', 'Acción']) expect(h).toContain(t);
    expect(h.match(/<th scope="col"/g)?.length).toBe(10);
    const c = celdas(h);
    for (const dato of ['V-1', 'Monterrey → Querétaro', 'Chofer 1', 'U-1', '$5,000.00', '$4,800.00', '$200.00']) expect(c.join('|')).toContain(dato);
    expect(c.join('|')).toContain('sin ruta capturada');
    expect(c.join('|')).toContain('Sin asignar');
  });
  it('el vínculo «Ver» conserva el sufijo del tenant y un viaje sin liquidación no tiene vínculo', () => {
    const h = pintarViajes();
    expect(h).toContain('href="/dashboard/liq-1?tenant=T1"');
    expect(h).not.toContain('liq-2');
  });
  it('PERMISO: sin dinero no existe ni la cabecera ni un solo peso (el jefe de tráfico)', () => {
    const h = pintarViajes({ verDinero: false, filas: [v(1, { anticipo: null, comprobado: null, diferencia: null })] });
    expect(h.match(/<th scope="col"/g)?.length).toBe(7);
    for (const t of ['Anticipo', 'Comprobado', 'Diferencia', 'Exacta']) expect(h).not.toContain(t);
    expect(h).not.toMatch(/\$\d/);
    expect(h).not.toContain('Diferencia en ámbar');
  });
  it('la diferencia 0 dice «Exacta», sobrante en ámbar y faltante en rojo (por clase, sin style=)', () => {
    const h = pintarViajes({ filas: [v(1, { diferencia: 0 }), v(2, { diferencia: 50 }), v(3, { diferencia: -50 })] });
    expect(h).toContain('rv-tl__ok">Exacta');
    expect(h).toContain('rv-tl__warn">$50.00');
    expect(h).toContain('rv-tl__bad">$50.00');
  });
  it('NINGUNA cabecera ofrece ordenar (el registro se pagina por cursor: ordenar la página fingiría ordenar el total)', () => {
    const h = pintarViajes();
    expect(h).not.toContain('aria-sort');
    expect(h).not.toContain('rv-tl__orden');
  });
  it('filtros, búsqueda GET con campos ocultos del tenant, importar solo a quien puede', () => {
    const h = pintarViajes({ filtro: 'abiertos', q: 'V-1' });
    for (const t of ['Todos', 'Abiertos', 'En cuadre', 'Liquidados', 'Escalados']) expect(h).toContain(t);
    expect(h).toContain('role="search"');
    expect(h).toContain('name="tenant" value="T1"');
    expect(h).toContain('name="f" value="abiertos"');
    expect(h).toContain('Importar desde tu TMS');
    expect(pintarViajes({ puedeImportar: false })).not.toContain('Importar desde tu TMS');
  });
  it('chips de filtros activos: estado y búsqueda; quitar uno conserva el otro y el tenant', () => {
    const h = pintarViajes({ filtro: 'abiertos', q: 'V-1' });
    expect(h).toContain('aria-label="Filtros activos"');
    expect(h).toContain('Quitar el filtro Estado: Abiertos');
    expect(h).toContain('Quitar el filtro Búsqueda: V-1');
    const etiqueta = [...h.matchAll(/<a\b[^>]*>/g)].map((m) => m[0]).find((a) => a.includes('Quitar el filtro Estado: Abiertos')) ?? '';
    const quitarEstado = (etiqueta.match(/href="([^"]+)"/)?.[1] ?? '').replace(/&amp;/g, '&');
    expect(quitarEstado).not.toBe('');
    const q = new URL(quitarEstado, 'https://x').searchParams;
    expect(Object.fromEntries(q)).toEqual({ tenant: 'T1', q: 'V-1' });
    expect(pintarViajes()).not.toContain('Filtros activos');
  });
  it('paginación por cursor intacta y vacío por filtro', () => {
    const h = pintarViajes({ cursor: 'CUR', hayMas: true, siguiente: 'SIG' });
    expect(h).toContain('Volver al inicio');
    expect(h).toContain('c=SIG');
    expect(h).toContain('Hasta 50 viajes por página');
    const vacio = pintarViajes({ filas: [], filtro: 'escalados', q: 'zzz' });
    expect(vacio).toContain('Ningún viaje coincide con «zzz» en «Escalados»');
    expect(vacio).not.toContain('<table');
  });
  it('sello de procedencia: «Registro de viajes · leído …», nunca «corte» (la pantalla no conoce el corte de la fuente)', () => {
    const h = pintarViajes();
    expect(h).toMatch(/Registro de viajes · leído \d{2} \w{3} 20\d{2}/);
    expect(h.match(/rv-sello__texto[^>]*>([^<]+)/)?.[1]).not.toContain('corte');
  });
  it('CSP: la estructura nueva (tabla, filas, celdas, chips, sello) no añade style= ni <style>; las pastillas compartidas (StatusPill) siguen como estaban', () => {
    const h = pintarViajes({ filtro: 'abiertos', q: 'V-1' });
    const tabla = h.match(/<table[\s\S]*<\/table>/)?.[0] ?? '';
    expect(tabla.length).toBeGreaterThan(100);
    expect(tabla).not.toMatch(/<(table|caption|thead|tbody|tr|th|td|a|ul|li|nav|time)\b[^>]*\sstyle=/);
    expect(h).not.toMatch(/<(div|ul|li|span)\b[^>]*class="rv-(chipsfiltro|sello|tl)[^"]*"[^>]*\sstyle=/);
    expect(pintarViajes()).not.toContain('<style');
  });
});

// ── Cola de liquidaciones ──
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fila = (i: number, e: Partial<FilaCola> = {}): FilaCola => ({
  id: U(i), viajeId: U(500 + i), folio: `V-${i}`, creadoEn: '2026-08-20T15:00:00+00:00', comprobado: 4900, anticipo: 5000, diferencia: 100,
  estatus: 'revisar', revision: 'pendiente', operadorNombre: `Chofer ${i}`, unidadEco: `C-${i}`, terminalNombre: 'Monterrey', ...e,
});
const pagina = (filas: FilaCola[], total = filas.length, siguiente: string | null = null): PaginaCola => ({ filas, total, hayMas: siguiente !== null, siguiente });
const TERMS = { opciones: [{ id: U(9), nombre: 'Monterrey' }], recortadas: false };
const pintarCola = async (p: PaginaCola, f = SIN_FILTROS) => renderToStaticMarkup(await SeccionCola({
  cola: Promise.resolve(p), filtros: f, terminales: Promise.resolve(TERMS), buscar: async () => [], contexto: [['tenant', 'flota-1']], sufijo: '?tenant=flota-1',
}));

describe('Cola de liquidaciones · misma función, tabla accesible', () => {
  it('las 8 columnas, cada celda, el vínculo «Revisar» con el sufijo y los pesos', async () => {
    const h = await pintarCola(pagina([fila(1), fila(2, { operadorNombre: null, unidadEco: null, diferencia: 0, estatus: 'cuadrada' })]));
    expect(h.match(/<th scope="col"/g)?.length).toBe(8);
    const c = celdas(h).join('|');
    for (const dato of ['V-1', 'Chofer 1', 'C-1', '$4,900.00', '$100.00', 'Revisar', 'Cuadrada']) expect(c).toContain(dato);
    expect(h).toContain(`href="/dashboard/${U(1)}?tenant=flota-1"`);
    // sin nombre no se inventa uno
    expect(celdas(h).filter((x) => x === '—').length).toBeGreaterThanOrEqual(2);
  });
  it('NO ofrece ordenar (la cola es por antigüedad y se pagina por cursor)', async () => {
    const h = await pintarCola(pagina([fila(1)]));
    expect(h).not.toContain('aria-sort');
    expect(h).toContain('Por antigüedad. La firma se pone en el detalle de cada una.');
  });
  it('cursor siguiente conserva el tenant y los filtros', async () => {
    const h = await pintarCola(pagina([fila(1)], 40, 'CURSOR'), { ...SIN_FILTROS, revision: 'rechazada', estado: 'revisar' });
    const href = (h.match(/rel="next"[^>]*href="([^"]+)"|href="([^"]+)"[^>]*rel="next"/) ?? []).slice(1).find(Boolean)!.replace(/&amp;/g, '&');
    expect(Object.fromEntries(new URLSearchParams(href.slice(1)))).toEqual({ tenant: 'flota-1', rev: 'rechazada', estado: 'revisar', cursor: 'CURSOR' });
  });
  it('el formulario de filtros de siempre sigue completo', async () => {
    const h = await pintarCola(pagina([fila(1)]));
    for (const n of ['rev', 'estado', 'terminal', 'desde', 'hasta']) expect(h).toContain(`name="${n}"`);
    expect(h).toContain('Filtrar');
  });
  it('chips: nombres reales (terminal, operador, unidad, fechas) y quitar uno conserva el resto', () => {
    const p = pagina([fila(7)]);
    const f = { ...SIN_FILTROS, revision: 'aprobada' as const, estado: 'con_diferencias' as const, operadorId: U(1), unidadId: U(2), terminalId: U(9), desde: '2026-10-01', hasta: '2026-10-31' };
    const chips = chipsDeCola(p, f, TERMS, [['tenant', 'flota-1']]);
    expect(chips.map((c) => `${c.etiqueta}=${c.valor}`)).toEqual(['Revisión=Aprobadas', 'Cuadre=Con diferencias', 'Operador=Chofer 7', 'Unidad=C-7', 'Terminal=Monterrey', 'Desde=01 oct 2026', 'Hasta=31 oct 2026']);
    const sinTerminal = new URLSearchParams(chips.find((c) => c.id === 'terminal')!.quitarHref.slice(1));
    expect(sinTerminal.get('terminal')).toBeNull();
    expect(sinTerminal.get('tenant')).toBe('flota-1');
    expect(sinTerminal.get('rev')).toBe('aprobada');
    expect(sinTerminal.get('desde')).toBe('2026-10-01');
  });
  it('sin filas que nombren al operador, el chip no inventa el nombre', () => {
    const chips = chipsDeCola(pagina([]), { ...SIN_FILTROS, operadorId: U(1) }, TERMS, []);
    expect(chips[0].valor).toBe('elegido');
  });
  it('«Quitar todos» limpia la query pero conserva el tenant', async () => {
    const h = await pintarCola(pagina([fila(1)], 1), { ...SIN_FILTROS, estado: 'revisar', desde: '2026-10-01' });
    expect(h).toContain('Quitar todos');
    expect(h).toContain('href="?tenant=flota-1"');
  });
  it('vacío con filtro dice que quites alguno; sin filtro, que no hay nada que firmar', async () => {
    expect(await pintarCola(pagina([]), { ...SIN_FILTROS, estado: 'revisar' })).toContain('Quita alguno para ver el resto de la cola');
    expect(await pintarCola(pagina([]))).toContain('No hay liquidaciones esperando a un humano');
  });
  it('sello: fuente y «leído», sin corte inventado', async () => {
    const h = await pintarCola(pagina([fila(1)]));
    expect(h).toMatch(/Cola de revisión · leído/);
    expect(h).not.toMatch(/Cola de revisión · corte/);
  });
});

// ── Bandeja de proveedores ──
const f = (n: number, e: Partial<FacturaProveedor> = {}): FacturaProveedor => ({
  id: `fac-${n}`, cfdiUuid: `uuid-${n}`, emisorRfc: `RFC${String(n).padStart(3, '0')}`, emisorNombre: null, receptorRfc: null, receptorEsFlota: true,
  fecha: `2026-10-${String((n % 28) + 1).padStart(2, '0')}`, subTotal: null, iva: null, total: n * 100, descripcion: `Servicio ${n}`, conceptos: 1,
  estado: 'pendiente', decididoPor: null, decididoEn: null, creadoEn: '2026-10-01T00:00:00Z', origen: 'correo', ocrConfianza: null, estadoSat: 'vigente',
  exportadaEn: null, requiereRevision: false, revisionMotivo: null, entregadaEn: null, tienePdf: false, fuenteDatos: 'xml', ...e,
} as FacturaProveedor);
const acc = async () => null;
const pintarBandeja = (facturas: FacturaProveedor[], params: Record<string, string> = {}) => renderToStaticMarkup(
  <VistaAgenteProveedores facturas={facturas} rfcFlota="AAA010101AAA" sufijo="?tenant=T1" params={params}
    acciones={{ subirFactura: acc, subirFoto: acc, decidir: acc, generarBuzon: acc, rotarBuzon: acc }}
    buzon={null} dominioConfigurado puedeAdministrarBuzon={false} />,
);
const rfcs = (h: string) => [...h.matchAll(/<th scope="row"[^>]*>[\s\S]*?(RFC\d{3}|sin RFC)[\s\S]*?<\/th>/g)].map((m) => m[1]);

describe('Bandeja de proveedores · misma función, tabla accesible', () => {
  const lista = [f(1), f(2, { estado: 'aprobada' }), f(3, { estado: 'rechazada', decididoPor: 'Ana', decididoEn: '2026-10-05T00:00:00Z' }), f(4, { receptorEsFlota: false, ocrConfianza: 0.7 }), f(5, { total: 50 })];
  it('por omisión: pendientes arriba, luego aprobadas y rechazadas (el orden de siempre)', () => {
    expect(rfcs(pintarBandeja(lista))).toEqual(['RFC001', 'RFC004', 'RFC005', 'RFC002', 'RFC003']);
  });
  it('todos los datos y avisos de cada fila siguen: receptor ajeno, OCR, SAT, decididor y los botones de decisión', () => {
    const h = pintarBandeja(lista);
    expect(h).toContain('receptor ajeno');
    expect(h).toMatch(/leída de foto \(OCR 0\.7\) — revisa contra el papel/);
    expect(h).toContain('vigente ante el SAT');
    expect(h).toContain('Pendiente');
    expect(h).toContain('Aprobada');
    expect(h).toContain('Rechazada');
    expect(h).toContain('Ana');
    expect(h).toContain('por correo');
    expect(h.match(/Aprobar/g)?.length ?? 0).toBeGreaterThanOrEqual(3); // un botón de decisión por factura pendiente
  });
  it('?orden=total&dir=desc ordena de verdad por el importe y lo marca con aria-sort', () => {
    const h = pintarBandeja(lista, { orden: 'total', dir: 'desc' });
    expect(rfcs(h)).toEqual(['RFC004', 'RFC003', 'RFC002', 'RFC001', 'RFC005']);
    expect(h).toContain('aria-sort="descending"');
  });
  it('paginación por URL a 25 filas, conservando tenant y orden; los controles de decisión siguen', () => {
    const muchas = Array.from({ length: 60 }, (_, i) => f(i + 1));
    const p1 = pintarBandeja(muchas);
    expect(rfcs(p1).length).toBe(25);
    expect(p1).toContain('1–25 de 60');
    const p3 = pintarBandeja(muchas, { pag: '3', orden: 'total', dir: 'asc' });
    expect(rfcs(p3).length).toBe(10);
    expect(p3).toContain('51–60 de 60');
    expect(p3).toContain('rel="prev"');
    const prev = (p3.match(/<a[^>]*rel="prev"[^>]*href="([^"]+)"|<a[^>]*href="([^"]+)"[^>]*rel="prev"/) ?? []).slice(1).find(Boolean)!.replace(/&amp;/g, '&');
    expect(Object.fromEntries(new URL(prev, 'https://x').searchParams)).toEqual({ orden: 'total', dir: 'asc', pag: '2' });
  });
  it('vacío: el mensaje de siempre, sin tabla', () => {
    const h = pintarBandeja([]);
    expect(h).toContain('Aún no hay facturas de proveedor');
    expect(h).not.toContain('Bandeja de facturas de proveedor</caption>');
  });
  it('sello honesto de la bandeja', () => {
    expect(pintarBandeja(lista)).toMatch(/Buzón de facturas · leído/);
  });
});

describe('Honestidad del dato: un conteo caído nunca es 0', () => {
  it('Viajes: si no se pudieron leer los conteos, cada celda dice «No disponible ahora. No es cero.» con Reintentar y ningún 0', () => {
    const h = pintarViajes({ conteos: { total: null, abiertos: null, enCuadre: null, liquidados: null, escalados: null } });
    expect(h.match(/No disponible ahora\. No es cero\./g)?.length).toBe(4);
    expect(h.match(/>Reintentar</g)?.length).toBeGreaterThanOrEqual(4);
    expect(h).not.toMatch(/rv-kpi__valor[^>]*>0</);
    expect(h).toContain('data-estado="error"');
  });
  it('un cero MEDIDO sí se pinta como 0 (la fuente lo dijo)', () => {
    const h = pintarViajes({ conteos: { ...conteos, abiertos: 0 } });
    expect(h).toMatch(/rv-kpi__valor[^>]*>0</);
    expect(h).not.toContain('No disponible ahora');
  });
});

describe('Ajustes del verificador (L6)', () => {
  it('chips de la cola: el nombre solo si es inequívoco; con nombres distintos o vacíos, «elegido»', () => {
    const f = { ...SIN_FILTROS, operadorId: U(1), unidadId: U(2) };
    const igual = chipsDeCola(pagina([fila(1, { operadorNombre: 'Ana', unidadEco: 'C-1' }), fila(2, { operadorNombre: 'Ana', unidadEco: 'C-1' })]), f, TERMS, []);
    expect(igual.map((c) => c.valor)).toEqual(['Ana', 'C-1']);
    const distinto = chipsDeCola(pagina([fila(1, { operadorNombre: 'Ana' }), fila(2, { operadorNombre: 'Luis' })]), f, TERMS, []);
    expect(distinto.find((c) => c.id === 'operador')!.valor).toBe('elegido');
    const vacio = chipsDeCola(pagina([fila(1, { operadorNombre: null, unidadEco: null })]), f, TERMS, []);
    expect(vacio.map((c) => c.valor)).toEqual(['elegido', 'elegida']);
  });
  it('la tira de Viajes no repite el sello en cada cifra: uno por tira y uno por tabla', () => {
    const h = pintarViajes();
    expect(h.match(/Registro de viajes · leído/g)?.length).toBe(2);
  });
  it('la tarjeta-fila conserva roles ARIA de tabla', () => {
    const h = pintarViajes();
    for (const r of ['role="table"', 'role="row"', 'role="columnheader"', 'role="rowheader"', 'role="cell"', 'role="rowgroup"']) expect(h).toContain(r);
  });
  it('cada «Reintentar» de cifra tiene nombre accesible propio', () => {
    const h = pintarViajes({ conteos: { total: null, abiertos: null, enCuadre: null, liquidados: null, escalados: null } });
    expect(h).toContain('aria-label="Reintentar: Abiertos"');
    expect(h).toContain('aria-label="Reintentar: Viajes en total"');
  });
  it('los guiones de relleno se marcan para ocultarse en la tarjeta móvil', () => {
    expect(pintarViajes()).toContain('rv-tl__nada');
  });
});

describe('Campo de búsqueda con icono (Viajes)', () => {
  it('la regla global de campos respeta pl-/pr-: el icono no se monta sobre el texto', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(new URL('../ui-v2/componentes.css', import.meta.url), 'utf8');
    expect(css).toMatch(/padding-inline: 10px; padding-block: 4px;/);
    expect(css).toMatch(/\[class\*="pl-"\], \[class\*="pr-"\]\) \{ padding-inline: 10px/);
    // El icono vive DENTRO del chip de búsqueda (flex), no sobre el campo: no hay texto que pisar.
    expect(pintarViajes()).toContain('rv-fl--buscar');
  });
});
