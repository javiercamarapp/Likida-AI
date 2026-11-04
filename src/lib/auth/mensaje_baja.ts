import type { ResultadoBaja } from './usuarios_escritura';

/**
 * CT-SEG-23: el texto que la pantalla le muestra a quien da de baja una cuenta. Dice la verdad de las DOS revocaciones
 * (sesion y llaves de API): si alguna fallo, la baja ya quedo pero alguien debe revisar a mano; si se revocaron llaves, se
 * nombran porque revocar es irreversible y quien integre un sistema con ellas debe emitir otra.
 */
export function mensajeDeBaja(r: Pick<ResultadoBaja, 'sesionRevocada' | 'llavesApiRevocadas' | 'llavesApiSinRevocar'>): { ok: true; mensaje: string } {
  const partes: string[] = [];
  partes.push(r.sesionRevocada
    ? 'Cuenta dada de baja: ya no entra al panel y su sesión quedó revocada.'
    : 'Cuenta dada de baja: ya no entra al panel. La revocación de su sesión en el servicio de autenticación NO se pudo confirmar — quedó registrado; avísale a Likida si se repite.');
  if (r.llavesApiRevocadas.length > 0) {
    partes.push(`También se revocaron sus llaves de API: ${r.llavesApiRevocadas.join(', ')}. Quien las usaba en un sistema debe emitir otra.`);
  }
  if (r.llavesApiSinRevocar) {
    partes.push('ATENCIÓN: NO se pudieron revocar sus llaves de API y siguen vivas. Revísalas y revócalas a mano en Ajustes > Llaves de API.');
  }
  return { ok: true, mensaje: partes.join(' ') };
}
