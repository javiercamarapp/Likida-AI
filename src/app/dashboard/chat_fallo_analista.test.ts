import { describe, it, expect, vi } from 'vitest';

// `chat.tsx` es un client component; sus imports estáticos (lucide-react,
// admin/charts) no necesitan DOM para las funciones puras que esta prueba
// ejercita, pero `next/navigation` sí revienta si no está montado.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { responder, respuestaLocal } from './chat';
import { motivoDeFallo } from './chat/respuestas';
import type { DashboardKpis, Acreditables } from '@/lib/likida/analytics';

// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 · H4 — un fallo REAL del analista se disfrazaba de respuesta
// normal.
//
// El servidor (`/api/dashboard/chat/route.ts:142`) manda
// `{t:'error', error:'el analista no pudo responder en este momento'}` con
// `resp.ok` en 200 (el fallo viaja DENTRO del NDJSON). `preguntarAnalista`
// pasaba derecho al respondedor local de palabras clave (`responder`, que
// contesta con `kpis`/`acred` YA cargados en la página, no con una lectura
// fresca) sin decir una palabra del error — el contralor veía una respuesta
// fluida y no tenía forma de saber que el agente que de verdad lee su
// operación no corrió. Lo mismo pasaba si el `fetch` reventaba (red, el
// timeout de 75s): el `catch` caía al mismo respondedor local, mudo.
//
// `respuestaLocal` es el arreglo: envuelve `responder()` con un aviso
// explícito CUANDO hubo un motivo de fallo, y no toca nada cuando no lo hubo
// (el paracaídas de una pregunta que el respondedor local tampoco entiende).
// ═══════════════════════════════════════════════════════════════════════════

const KPIS: DashboardKpis = {
  montoComprobado: 12000, viajesLiquidados: 4, conDiferencias: 1, porRevisar: 1,
  diferenciaDetectada: 300, tasaCuadre: 50,
} as DashboardKpis;
const ACRED: Acreditables = { iva: 1000, peaje: 200, litrosDiesel: 300 } as Acreditables;

describe('respuestaLocal — el fallo del analista se dice, no se disfraza', () => {
  it('con motivo: antepone el aviso del fallo al texto del respondedor local', () => {
    const r = respuestaLocal('¿cuánto llevo comprobado?', KPIS, ACRED, 'el analista no pudo responder en este momento');
    expect(r.texto).toMatch(/^El analista no pudo responder en este momento\./);
    expect(r.texto).toMatch(/lo último que ya tenía cargado, no una lectura nueva/i);
    // La respuesta de reserva sigue yendo — el aviso se AÑADE, no reemplaza.
    expect(r.texto).toContain(responder('¿cuánto llevo comprobado?', KPIS, ACRED).texto);
  });

  it('con motivo de red: el mensaje también se declara', () => {
    const r = respuestaLocal('¿cuál es mi tasa de cuadre?', KPIS, ACRED, 'no se pudo conectar con el analista');
    expect(r.texto).toMatch(/^No se pudo conectar con el analista\./);
  });

  it('sin motivo (null): es exactamente `responder()`, sin aviso — no todo paracaídas es un fallo del analista', () => {
    const conMotivo = respuestaLocal('hola', KPIS, ACRED, null);
    const sinMotivo = responder('hola', KPIS, ACRED);
    expect(conMotivo).toEqual(sinMotivo);
    expect(conMotivo.texto).not.toMatch(/no pudo/i);
  });

  it('conserva el visual de la respuesta local (tabla/dona/cifra) cuando sí hay motivo', () => {
    const r = respuestaLocal('¿cuánto llevo comprobado?', KPIS, ACRED, 'el analista no pudo responder en este momento');
    expect(r.visual).toEqual(responder('¿cuánto llevo comprobado?', KPIS, ACRED).visual);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// A41-AG-01 · La auditoría 24 cerró UNA de las dos puertas del fallo.
//
// `/api/dashboard/chat/route.ts` contesta con ESTADO en varios caminos —401
// «sin sesion» (:62), 403 «sin acceso» (:66), 429 «Demasiadas preguntas
// seguidas» (:69), 400 «cuerpo inválido» (:89)— y NINGUNO lleva `t:'error'`.
// `use-analista` miraba sólo `t`, así que esos casos daban `motivo = null`:
// `respuestaLocal` devolvía `responder()` intacto y `fallo` se quedaba sin
// poner. La pregunta 11 del minuto contestaba «Tu tasa de cuadre es 50%» con
// su dona —armada con los KPIs de la carga de la página, no con una lectura
// nueva— sin aviso y sin Reintentar (`mensajes.tsx:96` y `:127` cuelgan los
// dos de `r.fallo`).
//
// `motivoDeFallo` es la puerta única. Lo que se afirma aquí es que un estado
// HTTP de error PRODUCE motivo, que el motivo del NDJSON sigue mandando, y
// que una respuesta buena sigue sin motivo (si no, cada respuesta normal se
// pintaría como fallo, que es el error opuesto y peor).
// ═══════════════════════════════════════════════════════════════════════════

describe('motivoDeFallo — las dos puertas del fallo, no una', () => {
  it('429 con el texto del servidor: el motivo es ese texto', () => {
    const m = motivoDeFallo({ ok: false, status: 429 }, { error: 'Demasiadas preguntas seguidas; espera un momento.' });
    expect(m).toBe('Demasiadas preguntas seguidas; espera un momento.');
  });

  it('401 «sin sesion»: también declara motivo', () => {
    expect(motivoDeFallo({ ok: false, status: 401 }, { error: 'sin sesion' })).toBe('sin sesion');
  });

  it('503 con cuerpo ilegible: se dice el estado, que es poco pero es verdad', () => {
    expect(motivoDeFallo({ ok: false, status: 503 }, null)).toBe('El analista no pudo contestar (error 503)');
  });

  it('un `error` vacío no se pasa por motivo: caería un aviso sin frase', () => {
    expect(motivoDeFallo({ ok: false, status: 500 }, { error: '   ' })).toBe('El analista no pudo contestar (error 500)');
  });

  it('el fallo DENTRO del NDJSON (auditoría 24, resp.ok 200) sigue mandando', () => {
    const m = motivoDeFallo({ ok: true, status: 200 }, { t: 'error', error: 'el analista no pudo responder en este momento' });
    expect(m).toBe('el analista no pudo responder en este momento');
  });

  it('una respuesta BUENA no produce motivo — lo contrario pintaría de fallo cada turno', () => {
    expect(motivoDeFallo({ ok: true, status: 200 }, { bloques: [{ tipo: 'texto', texto: 'hola' }] })).toBeNull();
    expect(motivoDeFallo({ ok: true, status: 200 }, null)).toBeNull();
  });

  it('el 429 encadenado con `respuestaLocal` SÍ antepone el aviso (antes no se decía nada)', () => {
    const m = motivoDeFallo({ ok: false, status: 429 }, { error: 'Demasiadas preguntas seguidas; espera un momento.' });
    const r = respuestaLocal('¿cuál es mi tasa de cuadre?', KPIS, ACRED, m);
    expect(r.texto).toMatch(/^Demasiadas preguntas seguidas; espera un momento\./);
    expect(r.texto).toMatch(/lo último que ya tenía cargado, no una lectura nueva/i);
    // Y la cifra de reserva sigue ahí: el aviso se añade, no reemplaza.
    expect(r.texto).toContain(responder('¿cuál es mi tasa de cuadre?', KPIS, ACRED).texto);
  });
});
