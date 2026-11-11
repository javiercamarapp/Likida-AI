import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { Aviso } from '@/lib/avisos/modelo';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));
vi.mock('./acciones', () => ({ marcarAvisos: vi.fn(), guardarPreferenciaAviso: vi.fn(), guardarSilencioAviso: vi.fn() }));

const { default: PanelAvisos } = await import('./panel-avisos');
const { default: ConfigAvisos } = await import('./config-avisos');

const av = (p: Partial<Aviso> & { clave: string }): Aviso => ({
  fuente: 'talachas', categoria: 'escalaciones', severidad: 'atencion', titulo: `Titulo ${p.clave}`, detalle: null, href: '/admin/escalaciones', desde: null, silenciable: true, ...p,
});
const AVISOS = [
  av({ clave: 'a' }),
  av({ clave: 'b' }),
  av({ clave: 'arco', fuente: 'arco', severidad: 'critica', silenciable: false, desde: '2026-11-03T10:00:00.000Z' }),
];
const montar = (leidas: string[]) => renderToStaticMarkup(
  <PanelAvisos destino={{ panel: 'admin' }} ambito="admin" avisos={AVISOS} leidas={leidas} generadoEn="2026-11-11T18:00:00.000Z" sufijo="" errorLeidas={false} errorPrefs={false} />,
);

describe('PanelAvisos', () => {
  it('«No leídas» pinta exactamente los no leídos y el título cuenta los mismos', () => {
    const html = montar(['a']);
    expect(html).toContain('Titulo b');
    expect(html).toContain('Titulo arco');
    expect(html).not.toContain('Titulo a<');
    expect(html).toContain('2 avisos sin leer');
    // conteos de las pestañas: 2 no leídas, 1 leída, 3 todas
    expect(html).toMatch(/No leídas[\s\S]*?2[\s\S]*?Leídas[\s\S]*?1[\s\S]*?Todas[\s\S]*?3/);
  });

  it('lo que no se puede ocultar lo dice, no ofrece «Marcar leído» y aunque su clave esté leída sigue como no leído', () => {
    const html = montar(['arco']);
    expect(html).toContain('no se puede marcar como leído');
    expect(html).toContain('3 avisos sin leer');
    expect((html.match(/Marcar leído/g) ?? []).length).toBe(2); // solo a y b
  });

  it('cada aviso lleva origen, hora (la de espera si la fuente la sabe, si no la de la medición) y enlace', () => {
    const html = montar([]);
    expect(html).toContain('Solicitudes ARCO');
    expect(html).toContain('En espera desde');
    expect(html).toContain('medida a las');
    expect(html).toContain('href="/admin/escalaciones"');
  });

  it('un aviso sin pantalla lo dice en vez de inventar un enlace', () => {
    const html = renderToStaticMarkup(
      <PanelAvisos destino={{ panel: 'admin' }} ambito="admin" avisos={[av({ clave: 'x', href: null })]} leidas={[]} generadoEn="2026-11-11T18:00:00.000Z" sufijo="" errorLeidas={false} errorPrefs={false} />,
    );
    expect(html).toContain('Sin pantalla donde resolverlo');
  });

  it('si no se pudo leer qué se ha leído, lo dice', () => {
    const html = renderToStaticMarkup(
      <PanelAvisos destino={{ panel: 'admin' }} ambito="admin" avisos={AVISOS} leidas={[]} generadoEn="2026-11-11T18:00:00.000Z" sufijo="" errorLeidas errorPrefs={false} />,
    );
    expect(html).toContain('No se pudo leer qué avisos ya leíste');
  });

  it('el sufijo ?tenant= se arrastra a los enlaces del panel del cliente', () => {
    const html = renderToStaticMarkup(
      <PanelAvisos destino={{ panel: 'flota', tenant: 't1' }} ambito="flota" avisos={[av({ clave: 'h', href: '/dashboard/huerfanos', categoria: 'dinero' })]} leidas={[]} generadoEn="2026-11-11T18:00:00.000Z" sufijo="?tenant=t1" errorLeidas={false} errorPrefs={false} />,
    );
    expect(html).toContain('href="/dashboard/huerfanos?tenant=t1"');
  });
});

describe('ConfigAvisos', () => {
  const base = { destino: { panel: 'admin' } as const, ambito: 'admin' as const, silencio: { activo: false, desde: '22:00', hasta: '07:00', permiteCriticos: true }, errorPrefs: false, errorSilencio: false, ahoraMs: Date.parse('2026-11-11T18:00:00Z') };

  it('matriz de tipos por canal con lo guardado, y dice que correo y WhatsApp aún no envían', () => {
    const html = renderToStaticMarkup(<ConfigAvisos {...base} prefs={[{ categoria: 'costos', canal: 'app', activo: false }]} />);
    expect(html).toContain('Costos');
    expect(html).toContain('Escalaciones');
    expect(html).not.toContain('Operación'); // categoría del panel del cliente
    expect(html).toContain('todavía no está conectado');
    expect(html).toContain('Envío pendiente');
    // 5 tipos x 3 canales; solo costos/app desmarcada
    expect((html.match(/type="checkbox"/g) ?? []).length).toBeGreaterThanOrEqual(15);
    expect((html.match(/checked=""/g) ?? []).length).toBeGreaterThanOrEqual(14);
  });

  it('una lectura caída de preferencias se dice y no se presenta como guardado', () => {
    const html = renderToStaticMarkup(<ConfigAvisos {...base} prefs={[]} errorPrefs errorSilencio />);
    expect(html).toContain('no lo guardado');
  });
});
