import { describe, it, expect, vi } from 'vitest';

// `chat.tsx` es un client component; sus imports estáticos (lucide-react,
// admin/charts) no necesitan DOM para las funciones puras que esta prueba
// ejercita, pero `next/navigation` sí revienta si no está montado.
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));

import { responder, respuestaLocal } from './chat';
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
