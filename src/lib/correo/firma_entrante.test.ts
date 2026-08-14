import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verificarFirma, TOLERANCIA_MS, type CabecerasSvix } from './firma_entrante';

const SECRETO = 'whsec_' + Buffer.from('una-llave-de-webhook-de-pruebas').toString('base64');
const AHORA = 1_760_000_000_000;
const TS = String(Math.floor(AHORA / 1000));
const CUERPO = '{"type":"email.received","data":{"email_id":"abc"}}';

function firmar(cuerpo: string, id: string, ts: string, secreto = SECRETO): string {
  const llave = Buffer.from(secreto.slice(6), 'base64');
  const f = createHmac('sha256', llave).update(`${id}.${ts}.${cuerpo}`, 'utf8').digest('base64');
  return `v1,${f}`;
}

const cab = (extra: Partial<CabecerasSvix> = {}): CabecerasSvix => ({
  id: 'msg_1', timestamp: TS, signature: firmar(CUERPO, 'msg_1', TS), ...extra,
});

/** Estrecha el resultado a su rama de fallo. Además de callar a `tsc`, hace la
 *  aserción más fuerte: si la firma resultara VÁLIDA cuando la prueba espera un
 *  motivo, truena aquí en vez de comparar `undefined` con una cadena. */
function motivo(r: ReturnType<typeof verificarFirma>): string {
  expect(r.ok, 'se esperaba un rechazo y la firma pasó').toBe(false);
  return r.ok ? '' : r.motivo;
}

describe('una firma buena pasa', () => {
  it('acepta el webhook legítimo', () => {
    expect(verificarFirma(CUERPO, cab(), SECRETO, AHORA)).toEqual({ ok: true });
  });

  it('acepta el secreto sin el prefijo whsec_', () => {
    const sinPrefijo = SECRETO.slice(6);
    const c = cab({ signature: firmar(CUERPO, 'msg_1', TS, SECRETO) });
    expect(verificarFirma(CUERPO, c, sinPrefijo, AHORA).ok).toBe(true);
  });

  it('aguanta VARIAS firmas: así rota Svix sus secretos sin cortar el servicio', () => {
    const c = cab({ signature: `v1,firmaVieja ${firmar(CUERPO, 'msg_1', TS)}` });
    expect(verificarFirma(CUERPO, c, SECRETO, AHORA).ok).toBe(true);
  });
});

describe('sin secreto NO se confía — el fallo cerrado que importa', () => {
  it('undefined se rechaza', () => {
    // La alternativa —"si no hay secreto, confía"— convierte una variable de
    // entorno olvidada en un buzón abierto por el que cualquiera empuja gasto
    // falso a la contabilidad de un cliente.
    expect(verificarFirma(CUERPO, cab(), undefined, AHORA)).toEqual({ ok: false, motivo: 'sin_secreto' });
  });

  it('vacío también', () => {
    expect(motivo(verificarFirma(CUERPO, cab(), '', AHORA))).toBe('sin_secreto');
    expect(motivo(verificarFirma(CUERPO, cab(), 'whsec_', AHORA))).toBe('sin_secreto');
  });
});

describe('el cuerpo firmado es el CRUDO', () => {
  it('un cuerpo alterado en UN caracter no pasa', () => {
    expect(motivo(verificarFirma(CUERPO + ' ', cab(), SECRETO, AHORA))).toBe('firma_invalida');
  });

  it('reserializar el JSON rompe la firma — por eso se usa req.text()', () => {
    // JSON.parse + JSON.stringify reordena llaves y normaliza espacios: el
    // resultado ya no es lo que se firmó.
    const reserializado = JSON.stringify(JSON.parse(CUERPO));
    const c = cab({ signature: firmar(CUERPO, 'msg_1', TS) });
    // Solo tiene sentido afirmarlo si de verdad quedó distinto.
    if (reserializado !== CUERPO) {
      expect(motivo(verificarFirma(reserializado, c, SECRETO, AHORA))).toBe('firma_invalida');
    }
  });
});

describe('lo viejo se rechaza: sin esto un webhook capturado se reenvía mil veces', () => {
  it('dentro de la ventana pasa', () => {
    const c = cab();
    expect(verificarFirma(CUERPO, c, SECRETO, AHORA + TOLERANCIA_MS - 1000).ok).toBe(true);
  });

  it('pasada la ventana NO pasa, aunque la firma sea correcta', () => {
    const c = cab();
    expect(motivo(verificarFirma(CUERPO, c, SECRETO, AHORA + TOLERANCIA_MS + 1000))).toBe('fuera_de_tiempo');
  });

  it('un timestamp del FUTURO también se rechaza (reloj mal, o intento)', () => {
    const c = cab();
    expect(motivo(verificarFirma(CUERPO, c, SECRETO, AHORA - TOLERANCIA_MS - 1000))).toBe('fuera_de_tiempo');
  });

  it('un timestamp que no es número se rechaza en vez de convertirse en NaN', () => {
    expect(motivo(verificarFirma(CUERPO, cab({ timestamp: 'ayer' }), SECRETO, AHORA))).toBe('fuera_de_tiempo');
  });
});

describe('cabeceras y versiones', () => {
  it('si falta cualquiera de las tres, se rechaza', () => {
    for (const falta of ['id', 'timestamp', 'signature'] as const) {
      expect(motivo(verificarFirma(CUERPO, cab({ [falta]: null }), SECRETO, AHORA))).toBe('faltan_cabeceras');
    }
  });

  it('una versión de firma DESCONOCIDA no se acepta', () => {
    // Si mañana Svix saca v2, no la damos por buena sin implementarla.
    const c = cab({ signature: firmar(CUERPO, 'msg_1', TS).replace('v1,', 'v2,') });
    expect(motivo(verificarFirma(CUERPO, c, SECRETO, AHORA))).toBe('firma_invalida');
  });

  it('cambiar el id del mensaje invalida la firma', () => {
    const c = cab({ id: 'msg_otro' });
    expect(motivo(verificarFirma(CUERPO, c, SECRETO, AHORA))).toBe('firma_invalida');
  });

  it('otro secreto no abre', () => {
    const otro = 'whsec_' + Buffer.from('un-secreto-completamente-distinto').toString('base64');
    expect(motivo(verificarFirma(CUERPO, cab(), otro, AHORA))).toBe('firma_invalida');
  });
});
