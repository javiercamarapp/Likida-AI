/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ═══════════════════════════════════════════════════════════════════════════
// MUESTRARIO DEL CARRIL B (ui2-b2): TODAS las primitivas v2 reales en sus estados (vacío / carga / error /
// deshabilitado / hover-foco por clase) dentro del chrome v2 real. Datos 100 % sintéticos.
// Escribe $UI2_B_OUT/vistas/b01..b05.html; el detector (`scripts/ui2-calidad`) las mide como «componentes».
// Uso: UI2_B_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts muestrario-b
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';
import { Download, FileUp, Truck, Wallet, Route as Ruta, ShieldCheck } from 'lucide-react';

vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => '/dashboard',
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const P = await import('@/app/ui-v2/componentes');
const G = await import('@/app/ui-v2/graficas');
import { exigirV2Html } from './exigir_v2';
import { USUARIO, viajes } from './fixtures/logistica_mx';

const OUT = process.env.UI2_B_OUT ?? path.join(homedir(), 'likida-loop/frontend-plan/fase1/b2-trabajo');
const mxn = (v: number) => `$${Math.round(v).toLocaleString('en-US')}`;
const SERIE = [12, 14, 13, 17, 16, 21, 19, 24, 22, 27];
const SEMANAS = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S9', 'S10'];

function Bloque({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="card" style={{ padding: 12 }}>
      <h2 style={{ margin: '0 0 12px', fontSize: 14, fontWeight: 600, letterSpacing: '-.01em' }}>{titulo}</h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{children}</div>
    </section>
  );
}
const Fila = ({ children }: { children: ReactNode }) => <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>{children}</div>;
const Rejilla = ({ children, n = 2 }: { children: ReactNode; n?: number }) => <div style={{ display: 'grid', gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))`, gap: 12 }}>{children}</div>;

const V: Record<string, () => ReactNode> = {
  'b01-botones-chips': () => (
    <>
      <P.EncabezadoPagina rotulo="Muestrario" titulo="Botones, chips y avisos" descripcion="Primario tenue, 32 px, toque de 44 por ::after."
        acciones={<><P.Boton icono={<Download />}>Exportar</P.Boton><P.Boton icono={<FileUp />}>Entregar archivo</P.Boton></>} />
      <Bloque titulo="Botones">
        <Fila>
          <P.Boton variante="primary">Primario tenue</P.Boton><P.Boton>Secundario</P.Boton><P.Boton variante="ghost">Ghost</P.Boton>
          <P.Boton variante="danger-soft">Anular</P.Boton><P.Boton tamano="sm">Fila 28</P.Boton>
        </Fila>
        <Fila>
          <P.Boton disabled>Deshabilitado</P.Boton>
          <P.Boton loading>Guardando</P.Boton><P.BotonEnlace href="/dashboard/viajes" icono={<Truck />}>Enlace</P.BotonEnlace>
          <P.BotonEnlace href="/x" deshabilitado>Enlace deshabilitado</P.BotonEnlace>
        </Fila>
      </Bloque>
      <Bloque titulo="Chips y procedencia">
        <Fila>
          <P.Chip>Neutro</P.Chip><P.Chip tono="ok" tamano="estado">Cuadrada</P.Chip><P.Chip tono="warn" tamano="estado">En cuadre</P.Chip>
          <P.Chip tono="bad" tamano="estado">Revisar</P.Chip><P.Chip tono="info">Info</P.Chip>
          {[1, 2, 3, 4, 5, 6, 7, 8].map((n) => <P.Chip key={n} categoria={n as 1}>Matiz {n}</P.Chip>)}
        </Fila>
        <Fila><G.KindBadge tipo="observado" /><G.KindBadge tipo="estimado" /><G.KindBadge tipo="inferido" /><G.KindBadge tipo="sin_dato" /></Fila>
      </Bloque>
      <Bloque titulo="Avisos y switch">
        <P.Aviso titulo="Datos sintéticos de demostración">Una vez por página.</P.Aviso>
        <P.Aviso tono="warn" titulo="Periodo incompleto">Sin variación contra el mes anterior.</P.Aviso>
        <P.Aviso tono="error" titulo="No disponible ahora" acciones={<P.Boton tamano="sm">Reintentar</P.Boton>}>No es cero: la consulta no respondió a tiempo.</P.Aviso>
        <P.Aviso tono="ok">Guardado.</P.Aviso>
        <Fila><P.Switch nombre="sw1" etiqueta="Notificar por correo" defaultChecked /><P.Switch nombre="sw2" etiqueta="Apagado" /><P.Switch nombre="sw3" etiqueta="Deshabilitado" disabled /></Fila>
      </Bloque>
    </>
  ),
  'b02-campos-tablas': () => (
    <>
      <P.EncabezadoPagina titulo="Campos y tablas" descripcion="Alto visual 32 (36 en móvil), chevron con aire, tabla 36/40." />
      <Rejilla n={1}>
        <Bloque titulo="Campos">
          <div style={{ display: 'grid', gap: 8 }}>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Nombre del patio<input defaultValue="Patio Monterrey" /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Rol<select defaultValue="b"><option value="a">Dueño</option><option value="b">Encargado</option></select></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Deshabilitado<input disabled defaultValue="No editable" /></label>
            <label style={{ display: 'grid', gap: 4, fontSize: 12 }}>Vacío<input placeholder="persona@ejemplo.test" /></label>
          </div>
          <Fila><P.Boton variante="primary">Guardar</P.Boton><P.Boton>Cancelar</P.Boton></Fila>
        </Bloque>
        <Bloque titulo="Vacío (una línea punteada)">
          <P.EstadoVacio titulo="Sin desgloses todavía" accion={<P.BotonEnlace href="/dashboard/conexiones" tamano="sm">Ir a Conexiones</P.BotonEnlace>}>Entrega un archivo y aparece aquí.</P.EstadoVacio>
          <P.EstadoVacio titulo="Sin viajes en el periodo" />
        </Bloque>
      </Rejilla>
      <section className="card">
        <table>
          <thead><tr><th>Folio</th><th>Ruta</th><th className="num">Casetas</th><th className="num">Diferencia</th><th>Estado</th><th /></tr></thead>
          <tbody>
            {viajes(10, 5).map((v, i) => (
              <tr key={v.id}>
                <td>{v.folio}</td><td>{v.origen ?? '—'} → {v.destino ?? '—'}</td>
                <td className="num">{mxn(v.anticipo * 0.31)}</td><td className="num">{i % 4 === 3 ? '—' : mxn(i * 45 + 60)}</td>
                <td><P.Chip tamano="estado" tono={i % 3 === 0 ? 'bad' : 'ok'}>{i % 3 === 0 ? 'Revisar' : 'Cuadra'}</P.Chip></td>
                <td style={{ textAlign: 'right' }}><P.BotonEnlace href="/dashboard/viajes" tamano="sm" variante="ghost">Ver</P.BotonEnlace></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  ),
  'b03-kpi-graficas': () => (
    <>
      <P.EncabezadoPagina rotulo="Muestrario" titulo="Tira KPI y gráficas" descripcion="Una tarjeta de 112 px; color = identidad de la métrica." />
      <G.TiraKpi etiqueta="Indicadores de muestra" items={[
        { etiqueta: 'Monto comprobado', valor: '$4,825,340', icono: <Wallet />, metrica: 'dinero_comprobado', delta: { texto: '+4.2 %', dir: 'sube', bueno: 'sube' }, serie: SERIE, sello: 'TMS · hace 5 min' },
        { etiqueta: 'Peajes del periodo', valor: '$318,420', icono: <Ruta />, metrica: 'gasto_peajes', delta: { texto: '−2.1 %', dir: 'baja', bueno: 'baja' }, serie: SERIE.slice().reverse(), sello: 'Casetas · semana 43' },
        { etiqueta: 'Carta Porte completas', valor: '84', icono: <ShieldCheck />, metrica: 'cumplimiento_carta_porte', sello: '84 de 96 · hoy', segmentos: [{ etiqueta: 'Completas', valor: 84 }, { etiqueta: 'Pendientes', valor: 12 }] },
        { etiqueta: 'A tiempo', valor: null, icono: <Truck />, metrica: 'servicio_a_tiempo', sello: 'Sin lector verificado' },
      ]} />
      <Rejilla n={1}>
        <Bloque titulo="Área mínima"><G.AreaMini valores={SERIE} etiquetas={SEMANAS} matiz={1} etiqueta="Cierres por semana" formato={(v) => String(v)} /></Bloque>
        <Bloque titulo="Área sin serie (vacío)"><G.AreaMini valores={[7]} etiqueta="Serie corta" /></Bloque>
        <Bloque titulo="Dona (≤5 gajos de un matiz)"><G.DonaMini matiz={2} etiqueta="Gasto de ruta por rubro" gajos={[{ etiqueta: 'Diésel', valor: 91000 }, { etiqueta: 'Casetas', valor: 48200 }, { etiqueta: 'Maniobras', valor: 12900 }, { etiqueta: 'Viáticos', valor: 22100 }, { etiqueta: 'Otros', valor: null }]} formato={mxn} /></Bloque>
        <Bloque titulo="Barras apiladas, bullet y sparklines">
          <G.BarraApilada matiz={3} etiqueta="Estado de Carta Porte" tramos={[{ etiqueta: 'Completas', valor: 84 }, { etiqueta: 'En revisión', valor: 9 }, { etiqueta: 'Parcial', valor: 3, parcial: true }]} />
          <G.BarraApilada matiz={4} segmentada etiqueta="Anticipos" tramos={[{ etiqueta: 'Abiertos', valor: 17 }, { etiqueta: 'Por comprobar', valor: 6 }]} />
          <G.Bullet matiz={5} etiqueta="Servicio a tiempo" valor={91} meta={95} maximo={100} formato={(v) => `${v} %`} />
          <G.Bullet matiz={5} etiqueta="Sin dato" valor={null} />
          <Fila>{([1, 2, 3, 4, 5, 6, 7, 8] as const).map((m) => <G.Sparkline key={m} valores={SERIE} matiz={m} />)}</Fila>
        </Bloque>
      </Rejilla>
    </>
  ),
  'b04-estados': () => (
    <>
      <P.EncabezadoPagina titulo="Estados de gráfica y anillo" descripcion="Carga, error, vacío y avance." />
      <Rejilla n={1}>
        <Bloque titulo="Error"><G.ChartState estado="error" mensaje="No disponible ahora. No es cero: la consulta no respondió a tiempo." alto={120} accion={<P.Boton tamano="sm">Reintentar</P.Boton>} /></Bloque>
        <Bloque titulo="Vacío"><G.ChartState estado="vacio" mensaje="Sin datos en el periodo." alto={120} /></Bloque>
        <Bloque titulo="Avance y primario deshabilitado"><Fila><P.Boton variante="primary" disabled>Primario deshabilitado</P.Boton><G.ProgresoAnillo valor={72} etiqueta="Avance" /><G.ProgresoAnillo valor={null} etiqueta="Sin dato" /><G.CheckExito /></Fila></Bloque>
      </Rejilla>
    </>
  ),
  'b05-overlays': () => (
    <>
      <P.EncabezadoPagina titulo="Overlays" descripcion="Drawer 420 y Modal 440 (abiertos para la captura)." />
      <P.Drawer abierto={false} onCerrar={() => {}} titulo="Sus reglas" descripcion="Política vigente del agente" pie={<><P.Boton>Cerrar</P.Boton><P.Boton variante="primary">Guardar</P.Boton></>}>
        <p>Cuerpo del drawer con padding de 16.</p>
      </P.Drawer>
      <P.Modal abierto={false} onCerrar={() => {}} titulo="Confirmar firma" descripcion="Esta acción tiene efectos fiscales." pie={<><P.Boton>Cancelar</P.Boton><P.Boton variante="primary">Firmar</P.Boton></>}>
        <p>¿Firmar la liquidación del viaje?</p>
      </P.Modal>
    </>
  ),
};

describe('muestrario B', () => {
  it('renderiza las vistas con primitivas reales dentro del chrome v2', () => {
    mkdirSync(path.join(OUT, 'a/vistas'), { recursive: true });
    for (const [id, vista] of Object.entries(V)) {
      let html = renderToStaticMarkup(
        <Chrome nombre={USUARIO.nombre} rol="flota_admin" perfil="cinco_agentes" cerrarSesion={async () => {}}>
          <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>{vista()}</div>
        </Chrome>,
      );
      exigirV2Html(html, id);
      if (id === 'b05-overlays') html = html.replace(/<dialog class="rv-ov rv-ov--modal"/, '<dialog open class="rv-ov rv-ov--modal"');
      writeFileSync(path.join(OUT, 'a/vistas', `${id}.html`), html);
    }
  });
});
