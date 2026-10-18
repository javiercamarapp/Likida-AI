// ─────────────────────────────────────────────────────────────────────────────
// AGE-C20-A1 (auditoría 32, continuación 20) — el tablero de «sin señal de
// vida» invertía los dos hechos: presentaba como ENTREGADO el aviso que se
// perdió y como PERDIDO el que llegó.
//
// Es la regresión del arreglo de AGE-C19-A1 (`8c46589`), y su premisa es la
// que falla: «la escalera es secuencial, así que el error es siempre del
// ÚLTIMO nivel reclamado». Lo es para el error de la ESCALACIÓN, no para el
// de un aviso al chofer, porque:
//
//   1. un rechazo DEFINITIVO del aviso `n` escribe `marcaAvisoChoferFallido`,
//      que CONSERVA el nivel anterior (`senal_vida.ts:163`) — la marca es
//      acumulativa, no un booleano;
//   2. la escalera AVANZA tras ese rechazo en vez de repetirlo
//      (`senal_vida.ts:429`), y
//   3. `reclamarNivelSenalVida` NO limpia `ultimo_error` al reclamar el
//      siguiente nivel (`conductor/repo.ts:1288`): solo escribe
//      `nivel_enviado` y la marca de tiempo.
//
// Y como la escalera SIEMPRE termina en el nivel 3, el desenlace normal de
// cualquier rechazo definitivo era el tablero gritándole «el aviso al jefe de
// tráfico NO salió: nadie lo recibió», en urgente, al jefe que acababa de
// recibirlo en su teléfono.
//
// La atribución correcta ya estaba en la base: los niveles están EN la marca y
// `avisosFallidosAlChofer` ya los parseaba para no decirle al jefe «se le avisó
// dos veces». El tablero los ignoraba. Estas pruebas usan el texto REAL que el
// motor escribe (`marcaAvisoChoferFallido`), no un texto inventado — que es
// por lo que la prueba de la c19 podía pasar con el tablero mintiendo.
// ─────────────────────────────────────────────────────────────────────────────
import { describe, it, expect } from 'vitest';
import { episodiosVista } from './tablero';
import { marcaAvisoChoferFallido } from './senal_vida';
import type { EpisodioTablero } from './repo';

const base: EpisodioTablero = {
  id: 'e1', viajeId: 'v1', folio: 'F-77', operador: 'Ana', motivo: 'gps_obsoleto',
  abiertoEn: '2026-10-01T10:00:00Z', nivelEnviado: 0,
  aviso1En: null, aviso2En: null, escaladoEn: null, ultimoError: null,
  cerradoEn: null, cierreMotivo: null, respuesta: null,
};
const EN_1 = '2026-10-01T10:01:00Z';
const EN_2 = '2026-10-01T10:21:00Z';
const EN_3 = '2026-10-01T10:41:00Z';
const paso = (e: ReturnType<typeof episodiosVista>[number], en: string): string => e.pasos.find((p) => p.en === en)!.texto;

/** El texto que el motor escribe de verdad cuando Meta rechaza el aviso `n` en definitiva. */
const marca = (n: 1 | 2, previo: string | null = null) => marcaAvisoChoferFallido(previo, n, 'ventana de 24 h cerrada (131047)');

describe('AGE-C20-A1 · el tablero atribuye el fallo al aviso que de verdad no salió', () => {
  it('aviso 1 rechazado y aviso 2 ENTREGADO: el perdido es el 1, no el 2', () => {
    const [e] = episodiosVista([{ ...base, nivelEnviado: 2, aviso1En: EN_1, aviso2En: EN_2, ultimoError: marca(1) }]);
    expect(paso(e, EN_1)).toBe('Primer aviso al chofer: NO salió');
    expect(paso(e, EN_2)).toBe('Segundo aviso al chofer');
    expect(e.estado).toBe('Segundo aviso mandado, sin respuesta del chofer');
  });

  it('la escalación ENTREGADA no se le presenta como perdida al jefe que la recibió', () => {
    const [e] = episodiosVista([{ ...base, nivelEnviado: 3, aviso1En: EN_1, aviso2En: EN_2, escaladoEn: EN_3, ultimoError: marca(1) }]);
    expect(paso(e, EN_3)).toBe('Aviso al jefe de tráfico');
    expect(e.estado).toBe('Escalado al jefe de tráfico, sigue sin atenderse');
    expect(paso(e, EN_1)).toContain('NO salió'); // y el que sí se perdió sigue marcado
  });

  it('los DOS avisos rechazados: la marca acumulativa marca los dos', () => {
    const [e] = episodiosVista([{ ...base, nivelEnviado: 3, aviso1En: EN_1, aviso2En: EN_2, escaladoEn: EN_3, ultimoError: marca(2, marca(1)) }]);
    expect(paso(e, EN_1)).toContain('NO salió');
    expect(paso(e, EN_2)).toContain('NO salió');
    expect(paso(e, EN_3)).toBe('Aviso al jefe de tráfico');
  });

  it('la escalación que de VERDAD no salió sigue marcándose: ese error no lleva marca y es del nivel 3', () => {
    const [e] = episodiosVista([{ ...base, nivelEnviado: 3, aviso1En: EN_1, aviso2En: EN_2, escaladoEn: EN_3, ultimoError: 'sin_destinatario' }]);
    expect(paso(e, EN_3)).toBe('Aviso al jefe de tráfico: NO salió');
    expect(e.estado).toBe('El aviso al jefe de tráfico NO salió: nadie lo recibió');
    expect(paso(e, EN_1)).toBe('Primer aviso al chofer');
  });
});
