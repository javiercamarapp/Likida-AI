import { describe, it, expect } from 'vitest';
import { leerEventosSeguridadSamsara, esEventoGrave } from './eventos_seguridad';
import type { Http } from './tipos';

// ═══════════════════════════════════════════════════════════════════════════
// EL LECTOR DE EVENTOS DE CÁMARA: la frontera con el proveedor del cliente.
//
// Lo que más importa aquí es la CLASIFICACIÓN de gravedad (qué despierta al
// jefe y qué no) y la honestidad del 403: una credencial sin el scope de
// eventos no es "no hay eventos" — es "no puedo verlos", y son verdades
// distintas.
// ═══════════════════════════════════════════════════════════════════════════

const CRED = { token: 'tok-1' };

const respuesta = (estado: number, cuerpo: unknown): Http => async () => ({
  estado, cuerpo: typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo),
});

describe('esEventoGrave — qué despierta al jefe', () => {
  it('crash/impacto/volcadura son graves, en cualquier caso de mayúsculas', () => {
    // La doc v2 muestra PascalCase y la legacy camelCase — el clasificador no
    // puede depender de cuál manda el proveedor ese día.
    expect(esEventoGrave(['Crash'])).toBe(true);
    expect(esEventoGrave(['crash'])).toBe(true);
    expect(esEventoGrave(['HarshImpact'])).toBe(true);
    expect(esEventoGrave(['rolloverProtection'])).toBe(true);
    expect(esEventoGrave(['Braking', 'Crash'])).toBe(true);
  });

  it('un frenado brusco o una distracción NO abren expediente', () => {
    // La asimetría inversa al reconocedor de texto: la cámara que grita por
    // cada frenado entrena al jefe a ignorar el 🚨 real.
    expect(esEventoGrave(['Braking'])).toBe(false);
    expect(esEventoGrave(['HarshTurn', 'GenericDistraction', 'MobileUsage'])).toBe(false);
    expect(esEventoGrave(['ForwardCollisionWarning', 'NearCollison'])).toBe(false);
    expect(esEventoGrave([])).toBe(false);
  });

  it('un label desconocido del proveedor no revienta ni cuenta como grave', () => {
    expect(esEventoGrave(['LabelNuevoQueNadieConoce2027'])).toBe(false);
  });
});

describe('leerEventosSeguridadSamsara', () => {
  it('mapea el payload real del stream v2 (campos verificados 26-ago-2026)', async () => {
    const r = await leerEventosSeguridadSamsara(CRED, respuesta(200, {
      data: [{
        id: 'evt-1',
        startMs: '2026-08-26T18:00:00Z',
        asset: { id: '281474' },
        location: { latitude: 20.97, longitude: -89.62 },
        behaviorLabels: [{ label: 'Crash' }, { label: 'Braking' }],
        inboxEventUrl: 'https://cloud.samsara.com/o/x/safety/events/evt-1',
        maxAccelerationGForce: 2.4,
      }],
      pagination: { hasNextPage: false },
    }), '2026-08-26T17:30:00Z');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.eventos).toHaveLength(1);
    expect(r.eventos[0]).toMatchObject({
      eventoId: 'evt-1', assetId: '281474', lat: 20.97, lng: -89.62,
      etiquetas: ['Crash', 'Braking'], maxG: 2.4,
    });
  });

  it('un evento sin id o sin fecha se descarta — sin idempotencia no hay disparo', async () => {
    const r = await leerEventosSeguridadSamsara(CRED, respuesta(200, {
      data: [
        { startMs: '2026-08-26T18:00:00Z', behaviorLabels: [{ label: 'Crash' }] },
        { id: 'evt-2', startMs: 'no-es-fecha' },
        { id: 'evt-3', startMs: '2026-08-26T18:01:00Z', behaviorLabels: [] },
      ],
    }), '2026-08-26T17:30:00Z');
    expect(r.ok && r.eventos.map((e) => e.eventoId)).toEqual(['evt-3']);
  });

  it('el 403 se reporta como SIN PERMISO, con nombre del scope — no como silencio', async () => {
    const r = await leerEventosSeguridadSamsara(CRED, respuesta(403, ''), '2026-08-26T17:30:00Z');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.sinPermiso).toBe(true);
    expect(r.motivo).toContain('Read Safety Events & Scores');
  });

  it('el 401 es credencial mala, no falta de scope', async () => {
    const r = await leerEventosSeguridadSamsara(CRED, respuesta(401, ''), '2026-08-26T17:30:00Z');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.sinPermiso).toBeUndefined();
    expect(r.motivo).toContain('401');
  });

  it('sigue la paginación por endCursor y se detiene sin hasNextPage', async () => {
    const llamadas: string[] = [];
    const http: Http = async (p) => {
      llamadas.push(p.url);
      const conCursor = p.url.includes('after=cursor-2');
      return {
        estado: 200,
        cuerpo: JSON.stringify({
          data: [{ id: conCursor ? 'evt-b' : 'evt-a', startMs: '2026-08-26T18:00:00Z' }],
          pagination: conCursor ? { hasNextPage: false } : { hasNextPage: true, endCursor: 'cursor-2' },
        }),
      };
    };
    const r = await leerEventosSeguridadSamsara(CRED, http, '2026-08-26T17:30:00Z');
    expect(llamadas).toHaveLength(2);
    expect(r.ok && r.eventos.map((e) => e.eventoId)).toEqual(['evt-a', 'evt-b']);
    // Pide por fecha de CREACIÓN (no updatedAtTime): un cambio de estado de
    // coaching en el inbox de Samsara no debe re-entregar el evento.
    expect(llamadas[0]).toContain('queryByTimeField=createdAtTime');
    expect(llamadas[0]).toContain('startTime=');
  });

  it('sin token no llama a nadie', async () => {
    const r = await leerEventosSeguridadSamsara({}, respuesta(200, { data: [] }), '2026-08-26T17:30:00Z');
    expect(r.ok).toBe(false);
  });
});
