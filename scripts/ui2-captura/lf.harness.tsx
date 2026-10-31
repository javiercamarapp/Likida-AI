/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS LF (filtros compactos): las tres pantallas piloto REALES (Viajes, Cola de liquidaciones, Bandeja de proveedores) y el
// muestrario de TablaLista / SelloDato / AvisoCorte / BandaCobertura / ChipsFiltro / Tendencia en todos sus estados, dentro del
// chrome v2 real. Datos 100 % sintéticos (fixtures/logistica_mx).
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts lf
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => (globalThis as unknown as { __rutaLF?: string }).__rutaLF ?? '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const P = await import('@/app/ui-v2/componentes');
const { VistaViajes } = await import('@/app/dashboard/viajes/vista');
const { FiltrosTablero } = await import('@/app/dashboard/agentes/conductores/tablero-hitos');
const { SeccionCola } = await import('@/app/dashboard/agentes/liquidacion/cola');
import { SIN_FILTROS } from '@/lib/likida/revision';
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

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const cola = colaRevision(11).map((c, i) => ({ ...c, id: U(i + 1), viajeId: U(500 + i) }));


const catalogos = {
  terminales: [{ id: U(1), nombre: 'Patio Monterrey' }, { id: U(2), nombre: 'Patio Querétaro' }],
  clientes: [{ id: U(3), nombre: 'Distribuidora Norte' }, { id: U(4), nombre: 'Abarrotes del Bajío' }],
  operadores: OPERADORES.slice(0, 4).map((n, i) => ({ id: U(10 + i), nombre: String(n) })),
};

async function vistas(): Promise<Record<string, { ruta: string; el: ReactNode }>> {
  const colaEl = await SeccionCola({
    cola: Promise.resolve({ filas: cola, total: 87, hayMas: true, siguiente: 'CUR' }),
    filtros: { ...SIN_FILTROS, estado: 'con_diferencias', desde: '2026-10-01' },
    terminales: Promise.resolve({ opciones: [{ id: U(9), nombre: 'Patio Monterrey' }], recortadas: false }),
    buscar: async () => [], contexto: [['tenant', 'flota-demo']], sufijo: '?tenant=flota-demo',
  });
  return {
    'lf-01-viajes': {
      ruta: '/dashboard/viajes',
      el: <VistaViajes filas={filasViajes} filtro="abiertos" conteos={{ total: 128, abiertos: 12, enCuadre: 5, liquidados: 109, escalados: 2 }}
        sufijo="" importar={noop} puedeImportar verDinero q="V-41" cursor="c1" siguiente="c2" hayMas porPagina={11} />,
    },
    'lf-02-cola-liquidaciones': {
      ruta: '/dashboard/agentes/liquidacion',
      el: <P.MarcoPagina titulo="Liquidación de ruta" apoyo="La cola de lo que espera una firma humana, por antigüedad.">{colaEl}</P.MarcoPagina>,
    },
    'lf-03-tablero-conductores': {
      ruta: '/dashboard/agentes/conductores',
      el: (
        <P.MarcoPagina titulo="Tablero de hitos" apoyo="Viajes en curso y su semáforo.">
          <P.Tarjeta titulo="Viajes en curso">
            <FiltrosTablero f={{ terminalId: U(1), clienteId: '', operadorId: '', semaforo: 'atrasado', dias: 30 }} catalogos={catalogos}
              ocultos={{ tenant: 'flota-demo' }} accionUrl="/dashboard/agentes/conductores" />
          </P.Tarjeta>
        </P.MarcoPagina>
      ),
    },
    'lf-04-muestrario-filtros': {
      ruta: '/dashboard/muestrario-filtros',
      el: (
        <P.MarcoPagina area="Muestrario" titulo="Filtros de barra" apoyo="Todos los controles de la familia, en reposo, activos y deshabilitados.">
          <P.Tarjeta titulo="Barra GET: opciones, fechas, interruptor, búsqueda y Limpiar">
            <P.BarraFiltros accion="/x" enLinea etiqueta="Muestrario" nActivos={2} limpiarHref="/x">
              <P.FiltroOpciones nombre="a" etiqueta="Estado" valor="" opciones={[{ valor: '', rotulo: 'Todos' }, { valor: 'x', rotulo: 'Abiertos' }]} />
              <P.FiltroOpciones nombre="b" etiqueta="Cliente" valor="x" opciones={[{ valor: '', rotulo: 'Todos' }, { valor: 'x', rotulo: 'Distribuidora Norte' }]} />
              <P.FiltroOpciones nombre="c" etiqueta="Operador" valor="" deshabilitado opciones={[{ valor: '', rotulo: 'Todos' }]} />
              <P.FiltroFecha nombre="d" etiqueta="Desde" valor="2026-10-01" />
              <P.FiltroFecha nombre="h" etiqueta="Hasta" valor="" />
              <P.FiltroInterruptor nombre="i" etiqueta="Solo con excepciones" marcado />
              <P.FiltroInterruptor nombre="j" etiqueta="Solo críticos" marcado={false} />
              <P.FiltroBusqueda nombre="q" placeholder="Folio, origen o destino" />
            </P.BarraFiltros>
          </P.Tarjeta>
          <P.Tarjeta titulo="Barra de chips con búsqueda y «Filtros» avanzados">
            <P.BarraFiltros enLinea busqueda={{ valor: '', onCambio: () => {}, placeholder: 'Buscar folio' }} chips={[{ id: 'a', etiqueta: 'Todos', activo: true }, { id: 'b', etiqueta: 'Abiertos', activo: false }, { id: 'c', etiqueta: 'En cuadre', activo: false }]}
              avanzados={<span>Más filtros</span>} nAvanzados={2} fuentes="Fuentes 5 de 7" />
          </P.Tarjeta>
        </P.MarcoPagina>
      ),
    },
    'lf-05-viajes-chips-activos': {
      ruta: '/dashboard/viajes',
      el: <VistaViajes filas={filasViajes.slice(0, 5)} filtro="liquidados" conteos={{ total: 128, abiertos: 12, enCuadre: 5, liquidados: 109, escalados: 2 }}
        sufijo="" importar={noop} puedeImportar={false} verDinero q="" cursor={null} siguiente={null} hayMas={false} porPagina={50} />,
    },
  };
}

describe('LF', () => {
  it('renderiza cinco pantallas con la barra de filtros unica dentro del chrome v2', async () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [id, v] of Object.entries(await vistas())) {
      (globalThis as unknown as { __rutaLF?: string }).__rutaLF = v.ruta;
      const htmlCrudo = renderToStaticMarkup(<Chrome nombre={USUARIO.nombre} rol="flota_admin" cerrarSesion={async () => {}}>{v.el}</Chrome>);
      // Sin hidratar, el chip nace oculto (respaldo noscript); la captura simula el navegador ya hidratado.
      const html = htmlCrudo.replace(/<button([^>]*class="rv-fl[^"]*"[^>]*?) hidden=""/g, '<button$1');
      exigirV2Html(html, id);
      writeFileSync(path.join(OUT, 'vistas', `${id}.html`), html);
    }
    void AHORA;
  });
});
