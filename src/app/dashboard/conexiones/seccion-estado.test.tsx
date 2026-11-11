import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
// `getT` lee cookies y sesión; fuera de una petición cae a español, que es lo que se prueba aquí.
vi.mock('next/headers', () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock('@/lib/supabase/server', () => ({ supabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }));

import { CADENCIA_FUENTES, type EntradaFuente } from '@/lib/likida/fuentes/estado';
import { SeccionEstado } from './seccion-estado';
import { VistaConexiones } from './vista';

const AHORA = Date.UTC(2026, 10, 10, 18, 0, 0);
const entradas: EntradaFuente[] = [
  { id: 'whatsapp', lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - 60_000 },
  { id: 'tms', lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - CADENCIA_FUENTES.tms.esperadaMs * 2 },
  { id: 'gps', lectura: 'medida', configurada: true, ultimaSenalMs: AHORA - CADENCIA_FUENTES.gps.esperadaMs * 5 },
  { id: 'peajes', lectura: 'medida', configurada: false, ultimaSenalMs: null },
  { id: 'correo', lectura: 'caida', configurada: false, ultimaSenalMs: null },
  { id: 'sat', lectura: 'medida', configurada: false, ultimaSenalMs: null },
];

async function html(silencio: Parameters<typeof SeccionEstado>[0]['silencio'] = null) {
  return renderToStaticMarkup(await SeccionEstado({ entradas, silencio, ahoraMs: AHORA }));
}

describe('Conexiones · sección «Estado» por fuente', () => {
  it('pinta las seis fuentes con los cuatro estados y «sin dato», cada uno con texto', async () => {
    const h = await html();
    for (const id of ['whatsapp', 'tms', 'gps', 'peajes', 'correo', 'sat']) expect(h).toContain(`data-fuente="${id}"`);
    for (const t of ['Al día', 'Atrasada', 'Caída', 'Sin conectar', 'Sin dato']) expect(h).toContain(t);
  });
  it('la fuente que no se pudo leer no sale «Al día» y la sin conectar no sale como falla', async () => {
    const h = await html();
    const fila = (id: string) => h.split('<li ').find((x) => x.includes(`data-fuente="${id}"`)) ?? '';
    expect(fila('correo')).toContain('Sin dato');
    expect(fila('correo')).not.toContain('Al día');
    expect(fila('peajes')).toContain('Sin conectar');
    expect(fila('peajes')).not.toContain('Caída');
  });
  it('el resumen sale de las evaluaciones: «1 de 6 fuentes de datos al día» y «Arranque: 4 de 6 conectadas»', async () => {
    const h = await html();
    expect(h).toContain('1 de 6 fuentes de datos al día');
    expect(h).toContain('Arranque: 4 de 6 conectadas');
  });
  it('muestra la cadencia esperada de cada fuente', async () => {
    const h = await html();
    expect(h).toContain('cada 15 min');
    expect(h).toContain('cada 7 días');
  });
  it('el aviso de silencio solo aparece cuando la regla suena', async () => {
    expect(await html()).not.toContain('horas hábiles');
    const h = await html({ estado: 'silencio', hayAlerta: true, viajesAbiertos: 3, horasHabilesSinEvento: 12, umbralHoras: 10 });
    expect(h).toContain('Ningún evento de WhatsApp en 10 horas hábiles con 3 viajes abiertos');
  });
  it('VistaConexiones la monta antes del catálogo', () => {
    const h = renderToStaticMarkup(<VistaConexiones conectores={[]} estado={<p id="est">aquí</p>} />);
    expect(h.indexOf('id="est"')).toBeGreaterThan(-1);
  });
});
