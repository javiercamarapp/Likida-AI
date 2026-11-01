/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS L2b (encabezados, recuadros y estados): vistas REALES migradas (Viajes, Patios) y el muestrario de los estados únicos
// (cifras, tarjetas, avisos, vacío, error, esqueletos) dentro del chrome v2 real. Datos 100 % sintéticos (fixtures/logistica_mx).
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l2b
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

// La ruta de cada vista decide el área que el marco pone sobre el título (sale del menú del rol, como en producción).
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => (globalThis as unknown as { __rutaL2b?: string }).__rutaL2b ?? '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const P = await import('@/app/ui-v2/componentes');
const G = await import('@/app/ui-v2/graficas');
const { VistaViajes } = await import('@/app/dashboard/viajes/vista');
const { VistaPatios } = await import('@/app/dashboard/patios/vista');
import { exigirV2Html } from './exigir_v2';
import { USUARIO, viajes as viajesFx, OPERADORES, UNIDADES } from './fixtures/logistica_mx';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/.arnes');
const noop = async () => ({ ok: null }) as never;

const filasViajes = viajesFx(9).map((v, i) => ({
  id: v.id, folio: v.folio, origen: v.origen, destino: v.destino, estatus: v.estatus, operadorNombre: v.operadorNombre,
  unidadEco: UNIDADES[i % UNIDADES.length], fechaInicio: v.fechaInicio, intakePendientes: i === 2 ? 2 : 0,
  avisadoEn: v.operadorNombre ? '2026-10-27T08:10:00Z' : null, aceptadoEn: i % 3 === 0 ? '2026-10-27T08:40:00Z' : null,
  escaladoEn: i === 4 ? '2026-10-27T11:00:00Z' : null, avisosEnviados: v.operadorNombre ? 1 : 0,
  anticipo: v.anticipo, comprobado: v.estatus === 'liquidado' ? Math.round(v.anticipo * 0.96) : null,
  diferencia: v.estatus === 'liquidado' ? Math.round(v.anticipo * 0.04) : null, liqId: v.liqId,
  liqEstatus: v.estatus === 'liquidado' ? 'cuadrada' : null,
}));

const VISTAS: Record<string, { ruta: string; el: () => ReactNode }> = {
  'l2b-01-viajes': {
    ruta: '/dashboard/viajes',
    el: () => (
      <VistaViajes
        filas={filasViajes} filtro="todos" conteos={{ total: 128, abiertos: 12, enCuadre: 5, liquidados: 109, escalados: 2 }}
        sufijo="" importar={noop} puedeImportar verDinero q="" cursor={null} siguiente="c2" hayMas porPagina={9}
      />
    ),
  },
  'l2b-02-patios': {
    ruta: '/dashboard/patios',
    el: () => (
      <VistaPatios
        patios={[
          { id: 'p1', nombre: 'Patio Monterrey', ciudad: 'Monterrey', operadores: 14, unidades: 11, jefes: 1 },
          { id: 'p2', nombre: 'Patio Querétaro', ciudad: 'Querétaro', operadores: 9, unidades: 8, jefes: 1 },
          { id: 'p3', nombre: 'Patio Veracruz', ciudad: null, operadores: 4, unidades: 3, jefes: 0 },
        ]}
        jefes={[{ userId: 'u1', etiqueta: OPERADORES[0], terminalId: 'p1' }]}
        sinPatio={{ operadores: 3, unidades: 2 }} puedeAdministrar ilegible={false}
        hrefOperadores="/dashboard/operadores" hrefUnidades="/dashboard/unidades"
        crear={noop} editar={noop} eliminar={noop} asignarJefe={noop} asignarSinPatio={noop} patioDelJefe={null}
      />
    ),
  },
  'l2b-03-estados': {
    ruta: '/dashboard/estados-muestra',
    el: () => (
      <P.MarcoPagina area="Muestrario" titulo="Estados únicos" apoyo="Cifras, tarjetas, avisos, vacío, error y esqueletos: los mismos en todo el producto."
        acciones={<><P.Boton tamano="sm">Secundaria</P.Boton><P.Boton tamano="sm" variante="primary">Primaria</P.Boton></>}>
        <G.TiraCifras sello="Registro de viajes · corte 31 oct 2026" etiqueta="Cifras en sus estados">
          <G.Cifra etiqueta="Viajes en total" valor={1284} nota="histórico" metrica="volumen_viajes" deltaPct={{ pct: 4, bueno: true }} />
          <G.Cifra etiqueta="Sin teléfono" valor="7" nota="los agentes no pueden escribirles" tono="warn" />
          <G.Cifra etiqueta="Licencias vencidas" valor="2" tono="bad" />
          <G.Cifra etiqueta="Sin dato" valor="—" mensaje="no se pudo contar" />
          <G.Cifra etiqueta="Recuperable" valor={null} estado="error" reintentar />
        </G.TiraCifras>
        <P.Aviso tono="info" titulo="Qué es este aviso">Una sola oración de apoyo; lo largo va aquí, no en el encabezado.</P.Aviso>
        <P.Aviso tono="warn">Tu perfil fiscal sigue sin declararse: el estímulo de peaje se muestra en $0.</P.Aviso>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 12 }}>
          <P.Tarjeta titulo="Con datos" info="resumen.peajes_periodo" acciones={<P.Boton tamano="sm">Ver</P.Boton>}><p style={{ margin: 0 }}>Contenido de la tarjeta, 13 px.</p></P.Tarjeta>
          <P.Tarjeta titulo="Vacía" estado="vacio" mensaje="Sin cruces en el periodo" detalle="Cuando haya estados de cuenta, aquí verás los cruces." accionVacio={<P.Boton tamano="sm">Cargar estado de cuenta</P.Boton>} />
          <P.Tarjeta titulo="No disponible" estado="error" reintentar />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <P.Tarjeta titulo="Cargando" estado="cargando" esqueleto={<P.EsqTablaV2 filas={3} plana />} />
          <P.EstadoVacio pantalla titulo="Sin novedades">Nada de la flota pide a una persona en este momento.</P.EstadoVacio>
        </div>
        <P.EstadoError>No se pudo consultar el registro de viajes. No es cero: la consulta no respondió a tiempo.</P.EstadoError>
      </P.MarcoPagina>
    ),
  },
  'l2b-04-carga-pagina': { ruta: '/dashboard/viajes', el: () => <P.EsqPagina /> },
};

describe('L2b', () => {
  it('renderiza las vistas migradas y el muestrario de estados dentro del chrome v2', () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [id, v] of Object.entries(VISTAS)) {
      (globalThis as unknown as { __rutaL2b?: string }).__rutaL2b = v.ruta;
      const html = renderToStaticMarkup(
        <Chrome nombre={USUARIO.nombre} rol="flota_admin" cerrarSesion={async () => {}}>{v.el()}</Chrome>,
      );
      exigirV2Html(html, id);
      writeFileSync(path.join(OUT, 'vistas', `${id}.html`), html);
    }
  });
});
