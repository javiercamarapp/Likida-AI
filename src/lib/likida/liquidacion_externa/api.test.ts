import { describe, it, expect } from 'vitest';
import { motivoDeFallo, aLiquidacionExternaApi } from './api';
import type { LiquidacionExterna } from './repo';

// El error de un envío puede traer el CUERPO COMPLETO del JSON de Meta (con su
// `fbtrace_id`, el teléfono del chofer en el mensaje) o el texto de un error de
// nuestra base (con nombres de tablas). Ninguno de los dos puede cruzar a la API
// ni al panel: se traduce a un código estable y una frase escrita por nosotros.

describe('motivoDeFallo', () => {
  it('sin error no hay motivo (jamás un «todo bien» inventado desde un error vacío)', () => {
    expect(motivoDeFallo(null)).toBeNull();
    expect(motivoDeFallo('')).toBeNull();
  });

  it.each([
    ['terminal:HTTP 400: {"error":{"code":131047,"message":"Re-engagement message"}}', 'fuera_de_ventana'],
    ['HTTP 400 131026 message undeliverable', 'fuera_de_ventana'],
    ['131042', 'fuera_de_ventana'],
    ['terminal:HTTP 400: {"error":{"code":132001,"message":"Template name does not exist"}}', 'plantilla_no_aprobada'],
    ['code 132012 parameter format mismatch', 'plantilla_no_aprobada'],
    ['terminal:HTTP 400: {"error":{"code":131030,"message":"Recipient phone number not in allowed list"}}', 'numero_no_permitido'],
    ['HTTP 401: {"error":{"code":190,"message":"Access token has expired"}}', 'canal_whatsapp'],
    ['133016 account locked', 'canal_whatsapp'],
    ['terminal:HTTP 400: {"error":{"code":100,"message":"Invalid parameter"}}', 'rechazada_por_whatsapp'],
    ['HTTP 500: upstream', 'rechazada_por_whatsapp'],
    ['no se pudo encolar el mensaje (el outbox no respondió)', 'entrega_interna'],
    ['la liquidación no tiene PDF en Storage', 'entrega_interna'],
    ['relation "liquidacion_externa" does not exist', 'entrega_interna'],
    ['sin_wamid:abc', 'entrega_interna'],
  ])('%s → %s', (error, codigo) => {
    expect(motivoDeFallo(error)?.codigo).toBe(codigo);
  });

  it('la frase NUNCA repite el texto crudo: ni fbtrace, ni teléfono, ni nombres de tablas', () => {
    const crudos = [
      'terminal:HTTP 400: {"error":{"code":131030,"fbtrace_id":"AbCdEf","message":"(#131030) Recipient 5215512345678 not in allowed list"}}',
      'insert into liquidacion_externa violates relation "x" at storage.objects',
    ];
    for (const c of crudos) {
      const t = motivoDeFallo(c)!.texto;
      expect(t).not.toMatch(/fbtrace|5215512345678|relation|storage\.objects|liquidacion_externa|violates|HTTP \d/);
    }
  });

  it('el orden importa: una ventana cerrada no se confunde con «rechazada» genérica aunque diga HTTP 400', () => {
    expect(motivoDeFallo('terminal:HTTP 400: 131047')?.codigo).toBe('fuera_de_ventana');
  });
});

describe('aLiquidacionExternaApi', () => {
  const base: LiquidacionExterna = {
    id: '11111111-1111-4111-8111-111111111111', tenantId: 'TENANT-SECRETO', claveExterna: 'SAP-1', huella: 'HUELLA-SECRETA',
    sistemaOrigen: 'SAP', operadorId: 'o-1', operadorNombre: 'Juan', operadorTelefono: '525512345678',
    foliosViaje: ['V1', 'V2', 'V3'], viajeIds: ['a'], periodoDesde: '2026-09-01', periodoHasta: '2026-09-07',
    conceptos: [{ clave: null, descripcion: 'x', tipo: 'percepcion', monto: 1 }], total: 1, moneda: 'MXN',
    pdfRuta: 'TENANT-SECRETO/externas/SECRETA.pdf', pdfOrigen: 'adjunto', estado: 'enviada', via: 'plantilla', generacion: 3, intentos: 2,
    proximoIntentoEn: 'x', ultimoError: null, wamid: 'wamid.SECRETO', enviadaEn: '2026-09-08T10:00:00Z',
    acuseTipo: 'recibida', acuseEn: '2026-09-08T11:00:00Z', creadaEn: '2026-09-08T09:00:00Z',
  };

  it('expone lo del contrato y cuenta cuántos viajes existen en Likida', () => {
    const a = aLiquidacionExternaApi(base);
    expect(a).toMatchObject({
      id: base.id, claveExterna: 'SAP-1', viajes: ['V1', 'V2', 'V3'], viajesEnLikida: 1, estado: 'enviada', via: 'plantilla',
      respuestaChofer: 'recibida', respuestaEn: '2026-09-08T11:00:00Z', pdfOrigen: 'adjunto', operador: { id: 'o-1', nombre: 'Juan' },
    });
  });

  it('NO expone: tenant, huella, generación, intentos, wamid, teléfono, ruta del PDF ni el error crudo', () => {
    const texto = JSON.stringify(aLiquidacionExternaApi({ ...base, ultimoError: 'terminal:HTTP 400 {"fbtrace_id":"X"}' }));
    expect(texto).not.toMatch(/TENANT-SECRETO|HUELLA-SECRETA|SECRETA\.pdf|wamid\.SECRETO|525512345678|fbtrace|generacion|intentos|proximoIntento/);
  });

  it('sin respuesta del chofer, los campos son null (no una cadena vacía ni un «pendiente» inventado)', () => {
    const a = aLiquidacionExternaApi({ ...base, acuseTipo: null, acuseEn: null, estado: 'en_cola', via: null, enviadaEn: null });
    expect(a.respuestaChofer).toBeNull();
    expect(a.respuestaEn).toBeNull();
    expect(a.via).toBeNull();
    expect(a.enviadaEn).toBeNull();
    expect(a.fallo).toBeNull();
  });
});
