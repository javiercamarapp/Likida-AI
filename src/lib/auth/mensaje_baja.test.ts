import { describe, expect, it } from 'vitest';
import { mensajeDeBaja } from './mensaje_baja';

describe('CT-SEG-23 · el aviso de baja no esconde llaves de API vivas', () => {
  it('con revocacion fallida de llaves lo dice con ATENCION, aunque la sesion si se haya revocado', () => {
    const r = mensajeDeBaja({ sesionRevocada: true, llavesApiRevocadas: [], llavesApiSinRevocar: true });
    expect(r.mensaje).toMatch(/NO se pudieron revocar sus llaves de API/);
  });
  it('nombra las llaves revocadas', () => {
    const r = mensajeDeBaja({ sesionRevocada: true, llavesApiRevocadas: ['TMS propio', 'Tablero'], llavesApiSinRevocar: false });
    expect(r.mensaje).toMatch(/TMS propio, Tablero/);
    expect(r.mensaje).not.toMatch(/ATENCI/);
  });
  it('sin llaves y sesion revocada queda el mensaje de siempre', () => {
    const r = mensajeDeBaja({ sesionRevocada: true, llavesApiRevocadas: [], llavesApiSinRevocar: false });
    expect(r.mensaje).toBe('Cuenta dada de baja: ya no entra al panel y su sesión quedó revocada.');
  });
  it('sesion sin confirmar sigue avisando', () => {
    expect(mensajeDeBaja({ sesionRevocada: false, llavesApiRevocadas: [], llavesApiSinRevocar: false }).mensaje).toMatch(/NO se pudo confirmar/);
  });
});
