import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
const { SeccionGps } = await import('./seccion-gps');

const accion = async () => null;
const base = {
  salud: [{ clave: 'wialon', nombre: 'Wialon (Gurtam)', tono: 'bad' as const, estado: 'en espera tras una falla', texto: '3 fallas seguidas: la credencial fue rechazada o venció.' }],
  push: { fila: { clave: 'gps_push', nombre: 'GPS propio', tono: 'ok' as const, estado: 'sana', texto: 'Última recepción hace 2 min.' }, configurado: true, version: 2, recepciones: 40, rechazos: 1, previoHasta: null },
  endpoint: 'https://app.likida.ai/api/gps/push/abc',
  huerfanos: [{ proveedor: 'wialon', deviceId: '12001', ultimoVistoEn: '2026-10-01T15:00:00Z' }],
  hayMasHuerfanos: false,
  conteos: { activas: 250, conDispositivo: 240, sinDispositivo: 10, sinSenalNunca: 3 },
  puedeAdministrarGps: true, generarSecreto: accion, mapear: accion, plantillaCsv: 'x', hrefPatios: '/dashboard/patios',
};

describe('sección GPS de Conexiones', () => {
  it('pinta salud por integración con su causa, conteos honestos, el endpoint y los huérfanos', () => {
    const h = renderToStaticMarkup(<SeccionGps {...base} />);
    expect(h).toContain('Wialon (Gurtam) · en espera tras una falla');
    expect(h).toContain('recapturarla'.slice(0, 0) + 'la credencial fue rechazada o venció');
    expect(h).toContain('240 de 250 unidades activas tienen dispositivo GPS ligado');
    expect(h).toContain('10 no tienen');
    expect(h).toContain('3 lo tienen ligado y nunca han reportado');
    expect(h).toContain('https://app.likida.ai/api/gps/push/abc');
    expect(h).toContain('12001');
    expect(h).toContain('Likida NO crea unidades');
    expect(h).toContain('Rotar secreto');
  });
  it('sin proveedores dice qué falta; sin secreto ofrece generarlo; un no-dueño no ve botones ni importador', () => {
    const h = renderToStaticMarkup(<SeccionGps {...base} salud={[]} push={{ ...base.push, configurado: false, version: null }} puedeAdministrarGps={false} />);
    expect(h).toContain('Ningún proveedor de GPS tiene credencial activa');
    expect(h).toContain('Solo el dueño de la flota genera o rota el secreto');
    expect(h).not.toContain('Generar secreto');
    expect(h).not.toContain('Ligar dispositivos GPS desde Excel');
    const dueno = renderToStaticMarkup(<SeccionGps {...base} push={{ ...base.push, configurado: false, version: null }} />);
    expect(dueno).toContain('Generar secreto');
    expect(dueno).toContain('Ligar dispositivos GPS desde Excel');
  });
  it('sin huérfanos lo dice en verde', () => {
    expect(renderToStaticMarkup(<SeccionGps {...base} huerfanos={[]} />)).toContain('Ningún dispositivo huérfano');
  });
});
