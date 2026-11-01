/* eslint-disable security/detect-non-literal-fs-filename -- el arnés escribe en una ruta de salida propia */
// ARNÉS LO (onboarding): el chrome v2 REAL con pantallas reales (Puesta en marcha y Conexiones, datos sintéticos) y, encima, los componentes
// REALES del recorrido (tarjeta, invitación, pista, filas de la Guía) construidos con el recorrido REAL de `construirRecorrido` y el
// controlador REAL (cifras de paso y de pantalla salen de su instantánea). El foco y la etiqueta los coloca capturar-lo.mjs con la misma
// fórmula de capa.tsx sobre el rect MEDIDO del elemento real. Uso:
//   UI2_OUT=<dir> npx vitest run --config scripts/ui2-captura/vitest.config.mts lo.harness && node scripts/ui2-captura/compilar-css.mjs <dir>
//   node scripts/ui2-captura/capturar-lo.mjs <dir> <destino>
import { describe, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import type { ReactNode } from 'react';

let RUTA = '/dashboard/puesta-en-marcha';
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(),
  usePathname: () => RUTA,
  useRouter: () => ({ push() {}, replace() {}, refresh() {} }),
}));

const { default: Chrome } = await import('@/app/dashboard/shell/chrome-v2');
const { VistaPuestaEnMarcha } = await import('@/app/dashboard/puesta-en-marcha/vista');
const { VistaConexiones } = await import('@/app/dashboard/conexiones/vista');
const { GloboTour } = await import('@/app/ui-v2/movimiento/tour/globo');
const { TourProvider } = await import('@/app/ui-v2/movimiento/tour/proveedor');
const { InvitacionRecorrido } = await import('@/app/ui-v2/movimiento/tour/invitacion');
const { PistaContextual } = await import('@/app/ui-v2/movimiento/tour/pista');
const { ControladorTour } = await import('@/app/ui-v2/movimiento/tour/controlador');
const { AnfitrionFalso, ElementoFalso } = await import('@/app/ui-v2/movimiento/tour/anfitrion_falso');
const { FilasRecorrido, FilaNoVolver } = await import('@/app/dashboard/shell/menu-guia');
const { MenuList } = await import('@/app/ui-v2/componentes/overlay');
const { onboardingDeLaSesion } = await import('@/app/dashboard/recorridos');
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';
import type { Conector } from '@/lib/likida/conexiones';

const OUT = process.env.UI2_OUT ?? path.join(homedir(), 'likida-loop/cierre100/.arnes-lo');
const VACIAS: SenalesAsistente = {
  tms: 'sin_credencial', archivosRecibidos: 0, correoPlataforma: true,
  correoDesglose: { activa: false, usaCorreo: false, remitenteCapturado: false },
  operadores: { activos: 0, conCorreo: 0 }, unidadesActivas: 0, patios: 0, coordinadores: 0, supervisores: 0, revisorCartaPorte: false,
};
const CONECTORES: Conector[] = [
  { id: 'whatsapp', nombre: 'WhatsApp (choferes y oficina)', estado: 'incompleto', detalle: 'Variables del canal presentes en este entorno.', falta: [] },
  { id: 'rastreo', nombre: 'Rastreo GPS (credenciales del proveedor)', estado: 'sin_configurar', detalle: 'Sin conectar.', falta: ['capturar el acceso de tu proveedor de rastreo y probar la conexión'] },
];

const cuerpoPuesta = () => <VistaPuestaEnMarcha senales={VACIAS} ambito="t:u" tenantId="t" sufijo="" soloLectura={false} />;
const cuerpoConexiones = () => <VistaConexiones conectores={CONECTORES} credenciales={<section className="card p-4"><h2 className="font-display text-[14px] font-semibold">Credenciales de tus sistemas</h2></section>} />;

function pagina(cuerpo: ReactNode, ruta: string, rol: string, perfil: 'cinco_agentes' | null, encima: ReactNode = null) {
  RUTA = ruta;
  // El recorrido, la invitación y la pista se montan FUERA del chrome (como el TourProvider del layout): llevan su propio data-ui="v2".
  return renderToStaticMarkup(<><Chrome nombre="Ximena Salgado" rol={rol} perfil={perfil} cerrarSesion={async () => {}}>{cuerpo}</Chrome>{encima}</>);
}

/** Tarjeta + capa del paso `id` de un recorrido, con la instantánea REAL del controlador. */
function capaDePaso(r: ReturnType<typeof onboardingDeLaSesion>['recorridos'][number], id: string, lado: 'der' | 'izq' = 'der') {
  const host = new AnfitrionFalso();
  const i = r.pasos.findIndex((p) => p.id === id);
  if (i < 0) throw new Error(`paso ${id} no está en ${r.id}`);
  const paso = r.pasos[i];
  host.ruta = paso.ruta ?? '/dashboard';
  if (paso.ancla) host.anclas.set(paso.ancla, new ElementoFalso());
  const c = new ControladorTour(r, host, { ambito: 'arnes' });
  c.iniciar(i);
  host.tic(0);
  const snap = c.instantanea();
  const conEtiqueta = Boolean(paso.ancla) && (paso.tipo === 'ir' || paso.avance?.tipo === 'accion');
  const nombre = paso.tipo === 'ir' ? paso.nombrePantalla : paso.accion?.objetivo;
  const centrada = paso.tipo === 'cierre' || !paso.ancla;
  return (
    <div className="rv-tour" data-ui="v2" data-ancla={paso.ancla ?? ''}>
      <div className="rv-onb-capa" data-sin-foco data-scrim={centrada || undefined} aria-hidden="true"><div className="rv-onb-foco" /></div>
      {conEtiqueta ? <div className="rv-onb-etiqueta" aria-hidden="true"><span className="rv-onb-etiqueta__in"><svg className="rv-onb-etiqueta__flecha" viewBox="0 0 24 24"><path d="M12 5v14M6 13l6 6 6-6" /></svg>{`Haz clic aquí: ${nombre}`}</span></div> : null}
      <GloboTour snap={snap} lado={lado} centrada={centrada} onSiguiente={() => {}} onAtras={() => {}} onSaltar={() => {}} />
    </div>
  );
}

describe('arnés del onboarding', () => {
  it('renderiza las escenas del recorrido', async () => {
    mkdirSync(path.join(OUT, 'vistas'), { recursive: true });
    const sesion = onboardingDeLaSesion('flota_admin', 'cinco_agentes');
    const porId = (id: string) => sesion.recorridos.find((r) => r.id === id)!;
    const corto = porId('dueno.corto'), completo = porId('dueno.completo');
    const proveedor = (hijos: ReactNode) => (
      <TourProvider recorridos={sesion.recorridos} ambito="arnes" principal="dueno" asistente={sesion.asistente} pistas={sesion.pistas}>{hijos}</TourProvider>
    );
    const escenas: Array<[string, string]> = [];
    const poner = (id: string, html: string) => { escenas.push([id, html]); writeFileSync(path.join(OUT, 'vistas', `${id}.html`), html); };

    // 1) Salto de menú (ancla del menú real), 2) qué es la pantalla (encabezado real), 3) elemento clave, 4) acción, 5) cierre.
    poner('lo-01-ir-menu', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'flota_admin', 'cinco_agentes', capaDePaso(corto, 'despacho.ir')));
    poner('lo-02-que-pantalla', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'flota_admin', 'cinco_agentes', capaDePaso(completo, 'puesta-en-marcha.que')));
    poner('lo-03-clave-elemento', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'flota_admin', 'cinco_agentes', capaDePaso(completo, 'puesta-en-marcha.clave', 'izq')));
    poner('lo-04-accion', pagina(cuerpoConexiones(), '/dashboard/conexiones', 'flota_admin', 'cinco_agentes', capaDePaso(completo, 'conexiones.accion', 'izq')));
    poner('lo-05-cierre', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'flota_admin', 'cinco_agentes', capaDePaso(corto, 'cierre')));
    // 6) Invitación del primer ingreso, 7) pista contextual, 8) recorrido por agente.
    poner('lo-06-invitacion', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'flota_admin', 'cinco_agentes',
      <div className="rv-tour" data-ui="v2"><InvitacionRecorrido titulo={completo.titulo.replace(/^Recorrido: /, '')} asistente="Puesta en marcha" onElegir={() => {}} onAhoraNo={() => {}} onNoVolver={() => {}} /></div>));
    const pista = sesion.pistas['/dashboard/agentes/peajes/reclamacion'];
    poner('lo-07-pista', pagina(cuerpoConexiones(), '/dashboard/conexiones', 'flota_admin', 'cinco_agentes',
      <div className="rv-tour" data-ui="v2"><PistaContextual titulo={pista.titulo} texto={pista.texto} ilu={pista.ilu} desde={pista.desde} onEntendido={() => {}} onNoVolver={() => {}} /></div>));
    poner('lo-08-agente', pagina(cuerpoConexiones(), '/dashboard/conexiones', 'flota_admin', 'cinco_agentes', capaDePaso(porId('agente.peajes'), 'agentes-peajes.decide')));
    // 9) Menú Guía abierto con las filas REALES (corto, completo, saltar a una pantalla, agentes, primeros pasos, ayuda).
    const menu = (
      <div className="rv-pop" role="menu" aria-label="Guía" style={{ top: 52, right: 16 }}>
        <MenuList etiqueta="Guía">
          <FilasRecorrido alElegir={() => {}} />
          <span role="menuitem" className="rv-menu__item">Primeros pasos</span>
          <span role="menuitem" className="rv-menu__item">Centro de ayuda</span>
          <FilaNoVolver alElegir={() => {}} />
        </MenuList>
      </div>
    );
    poner('lo-09-guia-menu', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'flota_admin', 'cinco_agentes', proveedor(menu)));
    // 10) Otros roles: encargado (sin dinero) y nómina (solo conteos).
    const enc = onboardingDeLaSesion('encargado', null);
    poner('lo-10-encargado', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'encargado', null, capaDePaso(enc.recorridos.find((r) => r.id === 'encargado.corto')!, 'despacho.que')));
    const nom = onboardingDeLaSesion('nomina', 'cinco_agentes');
    poner('lo-11-nomina', pagina(cuerpoPuesta(), '/dashboard/puesta-en-marcha', 'nomina', 'cinco_agentes', capaDePaso(nom.recorridos.find((r) => r.id === 'nomina.completo')!, 'agentes-liquidacion.que')));
    writeFileSync(path.join(OUT, 'escenas.json'), JSON.stringify(escenas.map(([id]) => id)));
  });
});
