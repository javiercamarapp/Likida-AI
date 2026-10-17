// ─────────────────────────────────────────────────────────────────────────────
// AGE-C19-A1 (auditoría 32, continuación 19) — el tablero de «sin señal de
// vida» presenta un INTENTO como un aviso entregado.
//
// `reclamarNivelSenalVida` (`repo.ts:1289`) escribe la marca de tiempo del
// nivel AL RECLAMARLO, antes de mandar nada — es el candado que decide quién
// manda («quien pierde no manda nada»):
//
//     const cambio = nivel === 1 ? { nivel_enviado: 1, aviso_1_en: hora } : …
//
// El envío va DESPUÉS. Si falla, la marca de tiempo ya quedó escrita y el
// motivo cae en `viaje_senal_vida.ultimo_error` (mig. 0636:31). Hay dos
// lectores de esa tabla: el motor de la escalera (`trabajo.ts:417`) SÍ
// proyecta `ultimo_error`; el del tablero (`repo.ts:1397`) NO lo proyectaba.
//
// Resultado: el tablero afirmaba «Primer aviso al chofer» y «Primer aviso
// mandado, sin respuesta del chofer» de un mensaje que nunca salió de la
// máquina. Es la misma forma de AGE-C17-A1, donde `ok` no se proyectaba y
// quien contaba esas filas contaba intentos y los reportaba como entregados.
//
// La atribución es derivable sin ambigüedad: la escalera es secuencial y cada
// nivel sólo se reclama desde el anterior, así que el error es SIEMPRE del
// último nivel reclamado, que es exactamente `nivelEnviado`.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { episodiosVista } from './tablero';
import type { EpisodioTablero } from './repo';

const base: EpisodioTablero = {
  id: 'e1', viajeId: 'v1', folio: 'F-1', operador: 'Ana', motivo: 'gps_obsoleto',
  abiertoEn: '2026-10-01T10:00:00Z', nivelEnviado: 0,
  aviso1En: null, aviso2En: null, escaladoEn: null, ultimoError: null,
  cerradoEn: null, cierreMotivo: null, respuesta: null,
};

describe('AGE-C19-A1 · el tablero no afirma un aviso que no salió', () => {
  it('primer aviso reclamado pero rechazado: ni el paso ni el estado dicen que se mandó', () => {
    const [e] = episodiosVista([{
      ...base, nivelEnviado: 1, aviso1En: '2026-10-01T10:01:00Z',
      ultimoError: 'WhatsApp rechazó el mensaje',
    }]);
    const paso = e.pasos.find((p) => p.en === '2026-10-01T10:01:00Z')!;
    expect(paso.texto).toContain('NO salió');
    expect(e.estado).toContain('NO salió');
    // Y no se queda con la afirmación vieja.
    expect(e.estado).not.toBe('Primer aviso mandado, sin respuesta del chofer');
  });

  it('el error es del ÚLTIMO nivel reclamado: con el 2 fallido, el primer aviso sigue contando como entregado', () => {
    const [e] = episodiosVista([{
      ...base, nivelEnviado: 2,
      aviso1En: '2026-10-01T10:01:00Z', aviso2En: '2026-10-01T10:21:00Z',
      ultimoError: 'ventana de 24h cerrada',
    }]);
    expect(e.pasos.find((p) => p.en === '2026-10-01T10:01:00Z')!.texto).toBe('Primer aviso al chofer');
    expect(e.pasos.find((p) => p.en === '2026-10-01T10:21:00Z')!.texto).toContain('NO salió');
  });

  it('sin error no cambia nada: el camino sano se queda como estaba', () => {
    const [e] = episodiosVista([{
      ...base, nivelEnviado: 2, aviso1En: '2026-10-01T10:01:00Z', aviso2En: '2026-10-01T10:21:00Z',
    }]);
    expect(e.pasos.map((p) => p.texto)).toEqual(['Primer aviso al chofer', 'Segundo aviso al chofer']);
    expect(e.estado).toBe('Segundo aviso mandado, sin respuesta del chofer');
  });
});
