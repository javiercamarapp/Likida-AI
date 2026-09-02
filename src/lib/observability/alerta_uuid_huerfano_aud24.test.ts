// ═══════════════════════════════════════════════════════════════════════════
// AUD24 · PRU-A3 (ALTO, REINCIDENTE) — el correo de "uuid huérfano" tiene que
// preservar el UUID FISCAL íntegro, no una huella redactada (`id:<hash>`).
//
// `alerta.ts` YA exime `uuidFiscal`/`uuidCfdi`/`folioFiscal` de la redacción
// (`LLAVES_SIN_REDACTAR`) para cuando el UUID viaja como llave aparte. El
// bug real vivía en el LLAMADOR: `carta_porte_timbre.ts:317,379,409` mete
// el uuid DENTRO del texto de `error` (nunca como llave `uuidFiscal`
// aparte), y `error` no estaba exenta.
//
// AUDITORÍA 24 (integración): resuelto por el constructor `ops` con un
// mecanismo MÁS GENERAL que el que esta prueba anticipaba — no una
// exención de `carta_porte_timbre.ts` pasando una llave aparte, sino
// `FOLIO_NOMBRADO_RE` en `alerta.ts`: cualquier texto que nombre «uuid
// <uuid>» o «folio <uuid>» conserva ESE uuid íntegro a través de
// `redactarTexto`, sin importar en qué llave viaje. Cubre a
// `carta_porte_timbre.ts` y a cualquier otro llamador futuro con el mismo
// patrón de texto — verificado corriendo esta prueba contra el payload
// EXACTO de `carta_porte_timbre.ts:317` hoy.
// ═══════════════════════════════════════════════════════════════════════════

import { it, expect, vi, beforeEach, afterEach } from 'vitest';

const enviarCorreo = vi.fn().mockResolvedValue({ ok: true, id: 'correo-1' });
const correoConfigurado = vi.fn(() => true);
vi.mock('@/lib/correo/enviar', () => ({
  enviarCorreo: (...a: unknown[]) => enviarCorreo(...a),
  correoConfigurado: () => correoConfigurado(),
}));

beforeEach(() => {
  enviarCorreo.mockClear();
  vi.stubEnv('ALERTA_EMAIL', 'javier@likida.ai');
  vi.stubEnv('UPSTASH_REDIS_REST_URL', '');
  vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', '');
  vi.resetModules();
});
afterEach(() => vi.unstubAllEnvs());

it('AUD24 PRU-A3: el uuid del "uuid huérfano" llega ÍNTEGRO al correo, no como id:<huella>', async () => {
  const { alertarOperador } = await import('./alerta');
  const viajeId = 'v-777';
  const uuid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

  // Payload EXACTO de carta_porte_timbre.ts:317-320 hoy: el uuid solo vive
  // DENTRO de `error`, nunca como llave `uuidFiscal` aparte.
  await alertarOperador('timbre.uuid_huerfano', {
    error: `Viaje ${viajeId}: el PAC timbró el uuid ${uuid} y la consolidación no cerró. Ese folio fiscal existe ante el SAT y hay que registrarlo o cancelarlo a mano.`,
    codigo: 'timbre_uuid_huerfano',
  });

  expect(enviarCorreo).toHaveBeenCalledTimes(1);
  const cuerpo = JSON.stringify(enviarCorreo.mock.calls[0][1]);
  expect(cuerpo).toContain(uuid);
});
