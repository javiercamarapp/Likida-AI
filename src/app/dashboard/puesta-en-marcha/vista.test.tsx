import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ usePathname: () => '/dashboard/puesta-en-marcha', useRouter: () => ({ push: () => {} }) }));
vi.mock('./acciones', () => ({ enviarPruebaCorreo: async () => ({ ok: true, destino: 'a•••@x.mx' }) }));

import { VistaPuestaEnMarcha } from './vista';
import type { SenalesAsistente } from '@/lib/likida/asistente/pasos_cinco_agentes';

const vacias: SenalesAsistente = {
  tms: 'sin_credencial', archivosRecibidos: 0, correoPlataforma: true,
  correoDesglose: { activa: false, usaCorreo: false, remitenteCapturado: false },
  operadores: { activos: 0, conCorreo: 0 }, unidadesActivas: 0, patios: 0, coordinadores: 0, supervisores: 0, revisorCartaPorte: false,
};
const caidas: SenalesAsistente = {
  tms: null, archivosRecibidos: null, correoPlataforma: null, correoDesglose: null, operadores: null,
  unidadesActivas: null, patios: null, coordinadores: null, supervisores: null, revisorCartaPorte: null,
};
const html = (s: SenalesAsistente, soloLectura = false, pasoInicial?: 'tms') =>
  renderToStaticMarkup(<VistaPuestaEnMarcha senales={s} ambito="t:u" tenantId="t" sufijo="" soloLectura={soloLectura} pasoInicial={pasoInicial} />);
const tiene = (h: string, x: string) => h.includes(x);

describe('pantalla Puesta en marcha', () => {
  it('cuenta vacía: 0 de 6, seis pasos de ruta crítica y «Después» colapsado', () => {
    const h = html(vacias);
    expect(h).toContain('0 de 6');
    expect(h).toContain('Deja lista tu operación');
    for (const t of ['Tu equipo', 'Tu sistema de transporte', 'Correo', 'Operadores, unidades y supervisores', 'Quién revisa la Carta Porte', 'Simulacro de punta a punta']) expect(h).toContain(t);
    expect(h).toMatch(/<details class="rv-pem__despues">/);
    expect(h).not.toMatch(/<details[^>]* open/);
  });

  it('el paso elegido por omisión es el que le toca a la persona y su acción lleva a entregar el archivo de muestra', () => {
    const h = html(vacias, false, 'tms');
    expect(tiene(h, 'Entregar archivo de muestra')).toBe(true);
    expect(tiene(h, 'href="/dashboard/agentes/liquidacion"')).toBe(true);
    expect(tiene(h, 'Cómo conseguirlo')).toBe(true);
    // El primer renglón del paso es el archivo de muestra (la ruta por archivo es la real hoy).
    expect(h.indexOf('Entregar archivo de muestra')).toBeLessThan(h.indexOf('Conexión directa a tu sistema'));
  });

  it('con la lectura caída dice «No se pudo comprobar» y nunca pinta 0 como medición', () => {
    const h = html(caidas);
    expect(h).toContain('No se pudo comprobar');
    expect(h).not.toContain('NaN');
    expect(h).not.toContain('undefined');
  });

  it('trae las anclas data-tour estables del recorrido y los pasos son botones con aria-current', () => {
    const h = html(vacias, false, 'tms');
    for (const a of ['asistente.avance', 'asistente.lista', 'asistente.detalle', 'asistente.paso-tms', 'asistente.archivo', 'asistente.como-conseguirlo']) expect(tiene(h, `data-tour="${a}"`), a).toBe(true);
    expect(tiene(h, 'aria-current="step"')).toBe(true);
  });

  it('superadmin viendo como: lo avisa y no ofrece guardar confirmaciones ni omitir', () => {
    const h = html(vacias, true);
    expect(h).toContain('tus confirmaciones no se guardan');
    expect(h).not.toContain('Omitir este paso');
  });

  it('sin la interfaz nueva no se pinta el lanzador del recorrido (se confirma en el cliente)', () => {
    expect(html(vacias)).not.toContain('Ver recorrido');
  });
});
