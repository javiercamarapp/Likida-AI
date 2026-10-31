/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS L6 (datos y confianza): las tres pantallas piloto REALES (Viajes, Cola de liquidaciones, Bandeja de proveedores) y el
// muestrario de TablaLista / SelloDato / AvisoCorte / BandaCobertura / ChipsFiltro / Tendencia en todos sus estados, dentro del
// chrome v2 real. Datos 100 % sintéticos (fixtures/logistica_mx).
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l6
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => (globalThis as unknown as { __rutaL6?: string }).__rutaL6 ?? '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const P = await import('@/app/ui-v2/componentes');
const D = await import('@/app/ui-v2/datos');
const { VistaViajes } = await import('@/app/dashboard/viajes/vista');
const { VistaAgenteProveedores } = await import('@/app/dashboard/agentes/proveedores/vista');
const { SeccionCola } = await import('@/app/dashboard/agentes/liquidacion/cola');
import { SIN_FILTROS } from '@/lib/likida/revision';
import type { FacturaProveedor } from '@/lib/likida/proveedores';
import { exigirV2Html } from './exigir_v2';
import { USUARIO, viajes as viajesFx, colaRevision, OPERADORES, UNIDADES } from './fixtures/logistica_mx';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes');
const noop = async () => ({ ok: null }) as never;
const AHORA = Date.parse('2026-10-31T16:00:00Z');

const filasViajes = viajesFx(11).map((v, i) => ({
  id: v.id, folio: v.folio, origen: v.origen, destino: v.destino, estatus: v.estatus, operadorNombre: v.operadorNombre,
  unidadEco: UNIDADES[i % UNIDADES.length], fechaInicio: v.fechaInicio, intakePendientes: i === 2 ? 2 : 0,
  avisadoEn: v.operadorNombre ? '2026-10-27T08:10:00Z' : null, aceptadoEn: i % 3 === 0 ? '2026-10-27T08:40:00Z' : null,
  escaladoEn: i === 4 ? '2026-10-27T11:00:00Z' : null, avisosEnviados: v.operadorNombre ? 1 : 0,
  anticipo: v.anticipo, comprobado: v.estatus === 'liquidado' ? Math.round(v.anticipo * 0.96) : null,
  diferencia: v.estatus === 'liquidado' ? (i % 4 === 3 ? 0 : Math.round(v.anticipo * (i % 2 ? 0.04 : -0.03))) : null, liqId: v.liqId,
  liqEstatus: v.estatus === 'liquidado' ? 'cuadrada' : null,
}));

const factura = (n: number, e: Partial<FacturaProveedor> = {}): FacturaProveedor => ({
  id: `fac-${n}`, cfdiUuid: `uuid-${n}`, emisorRfc: ['TAL010203AB1', 'LLA990101XY2', 'DIE880415QW3', 'REF050607ZZ4'][n % 4], emisorNombre: null, receptorRfc: null, receptorEsFlota: n % 7 === 3 ? false : true,
  fecha: `2026-10-${String(((n * 3) % 27) + 1).padStart(2, '0')}`, subTotal: null, iva: null, total: 1200 + n * 437.5,
  descripcion: ['Mantenimiento mayor tractocamión', 'Llantas direccionales 11R22.5', 'Diésel ultra bajo azufre', 'Refacciones de frenos'][n % 4], conceptos: n % 5 === 0 ? 3 : 1,
  estado: n % 6 === 0 ? 'aprobada' : n % 6 === 1 ? 'rechazada' : 'pendiente', decididoPor: n % 6 <= 1 ? 'Ximena Salgado' : null, decididoEn: n % 6 <= 1 ? '2026-10-29T10:00:00Z' : null,
  creadoEn: '2026-10-01T00:00:00Z', origen: n % 3 === 0 ? 'subida' : 'correo', ocrConfianza: n % 9 === 4 ? 0.82 : null, estadoSat: n % 11 === 5 ? 'cancelado' : 'vigente',
  exportadaEn: null, requiereRevision: n % 9 === 4, revisionMotivo: null, entregadaEn: null, tienePdf: false, fuenteDatos: n % 9 === 4 ? 'pdf_vision' : 'xml', ...e,
} as FacturaProveedor);
const facturas = Array.from({ length: 31 }, (_, i) => factura(i + 1));

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cola = colaRevision(11).map((c, i) => ({ ...c, id: U(i + 1), viajeId: U(500 + i) }));

const filasTabla = viajesFx(7).map((v) => ({ id: v.id, folio: v.folio, ruta: v.origen && v.destino ? `${v.origen} → ${v.destino}` : null, total: v.anticipo, fecha: v.fechaInicio }));
type FilaMu = (typeof filasTabla)[number];
const colsMu: D.ColumnaTabla<FilaMu>[] = [
  { id: 'folio', titulo: 'Folio', principal: true, valor: (f) => f.folio, celda: (f) => f.folio },
  { id: 'ruta', titulo: 'Ruta', valor: (f) => f.ruta, celda: (f) => f.ruta ?? <span className="rv-tl__tenue">sin ruta capturada</span> },
  { id: 'fecha', titulo: 'Inicio', valor: (f) => f.fecha, celda: (f) => (f.fecha ? f.fecha.slice(0, 10) : '—') },
  { id: 'total', titulo: 'Anticipo', alinear: 'der', valor: (f) => f.total, celda: (f) => `$${f.total.toLocaleString('es-MX')}` },
];

async function vistas(): Promise<Record<string, { ruta: string; el: ReactNode }>> {
  const colaEl = await SeccionCola({
    cola: Promise.resolve({ filas: cola, total: 87, hayMas: true, siguiente: 'CUR' }),
    filtros: { ...SIN_FILTROS, estado: 'con_diferencias', desde: '2026-10-01' },
    terminales: Promise.resolve({ opciones: [{ id: U(9), nombre: 'Patio Monterrey' }], recortadas: false }),
    buscar: async () => [], contexto: [['tenant', 'flota-demo']], sufijo: '?tenant=flota-demo',
  });
  const pag = (ahora: number) => ahora;
  void pag;
  return {
    'l6-01-viajes': {
      ruta: '/dashboard/viajes',
      el: <VistaViajes filas={filasViajes} filtro="abiertos" conteos={{ total: 128, abiertos: 12, enCuadre: 5, liquidados: 109, escalados: 2 }}
        sufijo="" importar={noop} puedeImportar verDinero q="V-41" cursor="c1" siguiente="c2" hayMas porPagina={11} />,
    },
    'l6-02-viajes-sin-dinero-conteos-caidos': {
      ruta: '/dashboard/viajes',
      el: <VistaViajes filas={filasViajes.slice(0, 6).map((f) => ({ ...f, anticipo: null, comprobado: null, diferencia: null, liqId: null }))} filtro="todos"
        conteos={{ total: null, abiertos: null, enCuadre: null, liquidados: null, escalados: null }}
        sufijo="" importar={noop} puedeImportar={false} verDinero={false} q="" cursor={null} siguiente={null} hayMas={false} porPagina={50} />,
    },
    'l6-03-cola-liquidaciones': {
      ruta: '/dashboard/agentes/liquidacion',
      el: <P.MarcoPagina titulo="Liquidación de ruta" apoyo="La cola de lo que espera una firma humana, por antigüedad.">{colaEl}</P.MarcoPagina>,
    },
    'l6-04-bandeja-proveedores': {
      ruta: '/dashboard/agentes/proveedores',
      el: <VistaAgenteProveedores facturas={facturas} rfcFlota="AAA010101AAA" sufijo="" params={{ orden: 'total', dir: 'desc', pag: '2' }}
        acciones={{ subirFactura: noop, subirFoto: noop, decidir: noop, generarBuzon: noop, rotarBuzon: noop }}
        buzon={{ token: 'abcdefghjkmnpqrstvwxyz23', direccion: 'f-abcdefghjkmnpqrstvwxyz23@mail.likida.test' }} dominioConfigurado puedeAdministrarBuzon={false} />,
    },
    'l6-05-muestrario-datos': {
      ruta: '/dashboard/muestrario-datos',
      el: (
        <P.MarcoPagina area="Muestrario" titulo="Datos y confianza" apoyo="Sello de procedencia, corte, cobertura, filtros activos y tendencia: los mismos en todo el producto.">
          <D.AvisoCorte fuente="Registro de jornada" corte="2026-10-31" leidas={18} total={22} rotuloUnidad="operadores con captura" ahora={AHORA}>Revisa quién falta antes de cerrar el periodo.</D.AvisoCorte>
          <D.AvisoCorte fuente="Casetas (TAG)" corte="2026-10-22" ahora={AHORA}>Pide el estado de cuenta más reciente.</D.AvisoCorte>
          <D.AvisoCorte fuente="Registro de viajes" corte="2026-10-31" ahora={AHORA} />
          <D.AvisoCorte fuente="GPS" ahora={AHORA} />
          <D.BandaCobertura fuentes={[
            ...['TMS', 'GPS', 'Casetas', 'Combustible', 'Nómina'].map((nombre) => ({ nombre, estado: 'ok' as const })),
            { nombre: 'SAT', estado: 'fallo' as const, motivo: 'no respondió' }, { nombre: 'Buzón', estado: 'sin_datos' as const },
          ]} />
          <P.Tarjeta titulo="Sello de procedencia por clase de dato">
            <div style={{ display: 'grid', gap: 8 }}>
              <D.SelloDato tipo="observado" fuente="TMS" corte="2026-10-28" leidoEn={AHORA - 5 * 60_000} ahora={AHORA} />
              <D.SelloDato tipo="estimado" fuente="Costo por kilómetro" corte="2026-10-28" ahora={AHORA} />
              <D.SelloDato tipo="inferido" fuente="Casetas vs. ruta" leidoEn={AHORA - 3 * 3_600_000} ahora={AHORA} />
              <D.SelloDato tipo="sin_dato" fuente="Nómina" ahora={AHORA} />
            </div>
          </P.Tarjeta>
          <P.Tarjeta titulo="Tendencia: el color es el juicio de la métrica">
            <div style={{ display: 'grid', gap: 6, gridTemplateColumns: 'repeat(2, minmax(0,1fr))' }}>
              <span>Ingresos <D.Tendencia valor={8.4} bueno="sube" contra="vs mes anterior" /></span>
              <span>Horas de deuda <D.Tendencia valor={8.4} bueno="baja" contra="vs mes anterior" /></span>
              <span>Costo por km <D.Tendencia valor={-3.2} bueno="baja" contra="vs mes anterior" /></span>
              <span>Cuadre <D.Tendencia valor={-3.2} bueno="sube" contra="vs mes anterior" /></span>
              <span>Viajes <D.Tendencia valor={5} contra="vs mes anterior" /></span>
              <span>Sin base <D.Tendencia valor={null} bueno="sube" /></span>
            </div>
          </P.Tarjeta>
          <D.ChipsFiltro chips={[{ id: 'a', etiqueta: 'Estado', valor: 'Abiertos', quitarHref: '#' }, { id: 'b', etiqueta: 'Operador', valor: 'Chofer de ejemplo', quitarHref: '#' }, { id: 'c', etiqueta: 'Desde', valor: '01 oct 2026', quitarHref: '#' }]} quitarTodosHref="#" />
          <P.Tarjeta titulo="Tabla con orden y paginación por URL">
            <D.TablaLista<FilaMu> etiqueta="Anticipos por viaje" columnas={colsMu} filas={filasTabla} idFila={(f) => f.id} base="/dashboard/muestrario-datos" params={{ orden: 'total', dir: 'desc' }} orden="local" paginacion={{ tamano: 5 }}
              seleccion={{ nombre: 'ids', form: 'masiva', idFila: (f) => f.id, etiquetaFila: (f) => `Seleccionar ${f.folio}`, singular: 'seleccionado', plural: 'seleccionados' }} />
          </P.Tarjeta>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
            <P.Tarjeta titulo="Vacía"><D.TablaLista<FilaMu> etiqueta="Anticipos" columnas={colsMu} filas={[]} idFila={(f) => f.id} base="/x" params={{}} vacio={{ titulo: 'Sin viajes en el periodo', texto: 'Cuando despaches uno aparece aquí.' }} /></P.Tarjeta>
            <P.Tarjeta titulo="Error"><D.TablaLista<FilaMu> etiqueta="Anticipos" columnas={colsMu} filas={[]} idFila={(f) => f.id} base="/x" params={{}} estado="error" reintentar /></P.Tarjeta>
            <P.Tarjeta titulo="Cargando"><D.TablaLista<FilaMu> etiqueta="Anticipos" columnas={colsMu} filas={[]} idFila={(f) => f.id} base="/x" params={{}} estado="cargando" /></P.Tarjeta>
          </div>
        </P.MarcoPagina>
      ),
    },
  };
}

describe('L6', () => {
  it('renderiza los pilotos reales y el muestrario de datos y confianza dentro del chrome v2', async () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [id, v] of Object.entries(await vistas())) {
      (globalThis as unknown as { __rutaL6?: string }).__rutaL6 = v.ruta;
      const html = renderToStaticMarkup(<Chrome nombre={USUARIO.nombre} rol="flota_admin" cerrarSesion={async () => {}}>{v.el}</Chrome>);
      exigirV2Html(html, id);
      writeFileSync(path.join(OUT, 'vistas', `${id}.html`), html);
    }
    void OPERADORES;
  });
});
