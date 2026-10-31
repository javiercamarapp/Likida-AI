/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ═══════════════════════════════════════════════════════════════════════════
// ARNÉS L4 (tipografía por tokens, botones y campos únicos, ⓘ en cada recuadro): la vista REAL de Viajes (tabla, búsqueda, KPI) y un
// muestrario de formulario/botones/campos y de tarjetas con ⓘ, dentro del chrome v2 real. Datos 100 % sintéticos (fixtures/logistica_mx).
// Uso: UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts l4
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => (globalThis as unknown as { __rutaL4?: string }).__rutaL4 ?? '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const P = await import('@/app/ui-v2/componentes');
const G = await import('@/app/ui-v2/graficas');
const { VistaViajes } = await import('@/app/dashboard/viajes/vista');
import { exigirV2Html } from './exigir_v2';
import { USUARIO, viajes as viajesFx, UNIDADES } from './fixtures/logistica_mx';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/cierre100/arnes-l4');
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
  'l4-01-viajes': {
    ruta: '/dashboard/viajes',
    el: () => (
      <VistaViajes
        filas={filasViajes} filtro="todos" conteos={{ total: 128, abiertos: 12, enCuadre: 5, liquidados: 109, escalados: 2 }}
        sufijo="" importar={noop} puedeImportar verDinero q="" cursor={null} siguiente="c2" hayMas porPagina={9}
      />
    ),
  },
  'l4-02-formulario-botones': {
    ruta: '/dashboard/estados-muestra',
    el: () => (
      <P.MarcoPagina area="Muestrario" titulo="Campos y botones únicos" apoyo="Un solo campo (32, 36 bajo 820 px) y un solo botón en cuatro variantes y tres tamaños.">
        <section className="card p-4">
          <P.TituloRecuadro info="resumen.peajes_periodo">Formulario</P.TituloRecuadro>
          <form className="mt-3 grid gap-3 md:grid-cols-3">
            <label className="grid gap-1 text-[12px]">Folio<input type="text" defaultValue="VJ-20418" className="w-full hairline rounded-lg px-3 h-9 text-sm" /></label>
            <label className="grid gap-1 text-[12px]">Estatus
              <select className="w-full hairline rounded-lg px-3 h-9 text-[13px]" defaultValue="abierto"><option value="abierto">Abierto</option><option>En cuadre</option></select></label>
            <label className="grid gap-1 text-[12px]">Anticipo (vacío)<input type="number" placeholder="0.00" className="w-full hairline rounded-lg px-2.5 h-8 text-[12px]" /></label>
            <label className="grid gap-1 text-[12px]">Deshabilitado<input type="text" disabled defaultValue="Solo lectura" className="w-full hairline rounded-lg px-3 h-9 text-[13px]" /></label>
            <label className="grid gap-1 text-[12px]">Con error<input type="text" aria-invalid="true" defaultValue="12/ab" className="w-full hairline rounded-lg px-3 h-9 text-[13px]" /></label>
            <label className="grid gap-1 text-[12px]">Búsqueda con icono<input type="search" placeholder="Folio, origen o destino" className="h-8 pl-8 pr-3 rounded-lg hairline text-[12px] w-full" /></label>
            <label className="grid gap-1 text-[12px] md:col-span-3">Notas<textarea rows={3} placeholder="Escribe una nota para el operador" className="w-full hairline rounded-lg px-3 py-2 text-[13px]" /></label>
          </form>
          <div className="mt-4 flex flex-wrap items-center gap-2">
            <P.Boton variante="primary">Primario</P.Boton>
            <P.Boton>Secundario</P.Boton>
            <P.Boton variante="ghost">Fantasma</P.Boton>
            <P.Boton variante="danger">Peligro</P.Boton>
            <P.Boton variante="primary" disabled>Deshabilitado</P.Boton>
            <P.Boton variante="primary" loading>Guardando</P.Boton>
            <P.Boton tamano="sm">Compacto</P.Boton>
          </div>
          <table className="mt-4 w-full"><thead><tr><th>Viaje</th><th>Operador</th><th className="num">Anticipo</th><th>Acción</th></tr></thead>
            <tbody><tr><td>VJ-20418</td><td>Operador de muestra</td><td className="num">$4,200.00</td><td><P.Boton tamano="sm">Abrir</P.Boton></td></tr>
              <tr><td>VJ-20419</td><td>Operador de muestra</td><td className="num">$3,150.00</td><td><P.Boton tamano="sm" variante="danger">Anular</P.Boton></td></tr></tbody></table>
        </section>
      </P.MarcoPagina>
    ),
  },
  'l4-03-tarjetas-info': {
    ruta: '/dashboard/estados-muestra',
    el: () => (
      <P.MarcoPagina area="Muestrario" titulo="Recuadros con ⓘ" apoyo="Cada recuadro con título lleva su explicación: qué es, cómo se calcula y de dónde sale.">
        <G.TiraCifras sello="Registro de viajes · corte 31 oct 2026" etiqueta="Cifras con ⓘ">
          <G.Cifra etiqueta="Monto comprobado" valor={128400} formato="mxn" nota="periodo" info="resumen.monto_comprobado" />
          <G.Cifra etiqueta="Por revisar" valor="7" info="resumen.por_firmar" tono="warn" />
          <G.Cifra etiqueta="Peajes del periodo" valor="$18,240" info="resumen.peajes_periodo" />
          <G.Cifra etiqueta="Liquidaciones cerradas" valor="42" info="resumen.liquidaciones_cerradas" />
        </G.TiraCifras>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}>
          <P.Tarjeta titulo="Requiere tu atención" info="resumen.requiere_atencion"><p style={{ margin: 0 }}>Contenido de la tarjeta a 13 px, con tracking 0.</p></P.Tarjeta>
          <section className="card p-4"><P.TituloRecuadro info="resumen.siguiente_mejor_accion">Recuadro sin Tarjeta</P.TituloRecuadro><p className="mt-2 text-[13px]">Mismo título 14/600 y la misma ⓘ.</p></section>
        </div>
      </P.MarcoPagina>
    ),
  },
};

describe('L4', () => {
  it('renderiza Viajes, el muestrario de campos y botones y el de recuadros con ⓘ dentro del chrome v2', () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    for (const [id, v] of Object.entries(VISTAS)) {
      (globalThis as unknown as { __rutaL4?: string }).__rutaL4 = v.ruta;
      const html = renderToStaticMarkup(
        <Chrome nombre={USUARIO.nombre} rol="flota_admin" cerrarSesion={async () => {}}>{v.el()}</Chrome>,
      );
      exigirV2Html(html, id);
      writeFileSync(path.join(OUT, 'vistas', `${id}.html`), html);
    }
  });
});
