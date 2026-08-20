import { describe, it, expect } from 'vitest';
import { enrutar, mensajeParaEncargado, repartir } from './enrutar';
import { armar } from './pendientes';

// ═══════════════════════════════════════════════════════════════════════════
// QUIÉN FACTURA CADA TICKET: la máquina o una persona.
//
// La regla salió de un dato verificado abriendo portales el 29-jul: G500 se
// factura con solo el RFC (CFDI emitido, UUID B0800A68…) y La Gas exige correo,
// teléfono y contraseña. La misma distinción que aquí decide el camino.
//
// EL TERCER CAMINO existe porque hay tickets que NADIE puede facturar con lo que
// se leyó: sin portal reconocido, sin un campo requerido, o ya vencidos.
// Mandarlos a la máquina sería llenar un formulario con huecos; mandarlos al
// encargado como "listo para capturar" sería mentirle.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-04';
const g = (o: Record<string, unknown>) => ({
  id: String(o.id ?? '1'), concepto: String(o.concepto ?? 'diesel'), monto: Number(o.monto ?? 400),
  fecha: (o.fecha as string) ?? '2026-08-04', folio: 'folio' in o ? (o.folio as string) : '12345',
  rfc_emisor: null, cfdi_uuid: null, ocr_extra: (o.extra ?? {}) as Record<string, unknown>,
});
const CON_CUENTA = { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '650', estacion: 'E1' };
const SIN_CUENTA = { urlFacturacion: 'https://facturacion.enerser.com.mx/', webId: '650', estacion: 'E1' };

describe('enrutar', () => {
  it('sin cuenta → lo hace la máquina', () => {
    const r = enrutar(armar(g({ extra: SIN_CUENTA }), HOY), true);
    expect(r.via).toBe('automatico');
  });

  it('con cuenta → va con el encargado, que es quien tiene la sesión', () => {
    const r = enrutar(armar(g({ extra: CON_CUENTA }), HOY), true);
    expect(r.via).toBe('mensaje');
    if (r.via === 'mensaje') expect(r.motivo).toBe('requiere_cuenta');
  });

  // ═══════════════════════════════════════════════════════════════════════
  // LA CUENTA COMPARTIDA — 20-ago-2026, el cofre entra a la decisión.
  //
  // «Con cuenta → persona» descansaba en una premisa: solo el encargado tiene
  // la sesión. Cuando la flota comparte su acceso en /dashboard/conexiones, la
  // premisa se cae, y el ticket sigue el mismo filtro que los sin cuenta.
  // ═══════════════════════════════════════════════════════════════════════
  it('con cuenta COMPARTIDA y robot escrito → lo hace la máquina', () => {
    const r = enrutar(armar(g({ extra: CON_CUENTA }), HOY), true, true);
    expect(r.via, 'la razón de mandarlo a la persona era la sesión, y ya la tiene la máquina').toBe('automatico');
  });

  it('con cuenta compartida pero SIN robot → persona, y el motivo es sin_robot, no la cuenta', () => {
    const r = enrutar(armar(g({ extra: CON_CUENTA }), HOY), false, true);
    expect(r.via).toBe('mensaje');
    // El motivo importa: "requiere_cuenta" mandaría al encargado a buscar una
    // contraseña que él mismo ya entregó.
    if (r.via === 'mensaje') expect(r.motivo).toBe('sin_robot');
  });

  it('la cuenta compartida NO salta el bloqueo: un CAPTCHA sigue siendo de persona', () => {
    const conBloqueo = armar(g({ extra: CON_CUENTA }), HOY);
    conBloqueo.bloqueo = { motivo: 'el portal pidió CAPTCHA', desde: '2026-08-04T10:00:00Z' };
    const r = enrutar(conBloqueo, true, true);
    expect(r.via).toBe('mensaje');
    if (r.via === 'mensaje') expect(r.motivo).toBe('bloqueado');
  });

  it('portal no reconocido → incompleto, y dice cuál es el problema', () => {
    const r = enrutar(armar(g({ extra: {} }), HOY), true);
    expect(r.via).toBe('incompleto');
    if (r.via === 'incompleto') expect(r.falta.join(' ')).toMatch(/liga/);
  });

  // ═══════════════════════════════════════════════════════════════════════
  // EL SILENCIO — 20-ago-2026, con un ticket de G500 Sureste en la mano.
  //
  // Esta función decidía «máquina o persona» mirando UNA sola cosa: si el
  // portal pide cuenta. Su encabezado lo dice con número: «sin cuenta (26 de
  // 37) → lo hace la máquina». Adaptadores escritos hay UNO.
  //
  // O sea que 25 comercios quedaban enrutados a un robot que no existe:
  // `facturarAlVuelo` los rechazaba con `sin_adaptador` y el aviso de WhatsApp
  // NO los llevaba, porque `avisar.ts` solo manda lo que esta función marcó
  // para una persona. Ni se facturaban, ni nadie se enteraba — con el portal
  // ahí, los datos leídos y el plazo corriendo.
  // ═══════════════════════════════════════════════════════════════════════
  it('sin cuenta pero SIN ADAPTADOR → va con la persona, no a un robot que no existe', () => {
    const r = enrutar(armar(g({ extra: SIN_CUENTA }), HOY), false);
    expect(r.via, 'enrutarlo a la máquina es condenarlo al silencio').toBe('mensaje');
    if (r.via === 'mensaje') {
      expect(r.motivo).toBe('sin_robot');
      // Y va con TODO lo que la persona necesita: es lo que hace que el aviso
      // sirva en vez de solo avisar.
      expect(r.portal).toBeTruthy();
      expect(r.campos.length).toBeGreaterThan(0);
    }
  });

  it('el mensaje dice que el hueco es NUESTRO, no del encargado', () => {
    const r = enrutar(armar(g({ extra: SIN_CUENTA }), HOY), false);
    if (r.via !== 'mensaje') throw new Error('debía ir con la persona');
    const texto = mensajeParaEncargado(armar(g({ extra: SIN_CUENTA }), HOY), r);
    expect(texto, 'la liga primero: es lo que se toca en el teléfono').toContain(r.portal);
    expect(texto).toMatch(/todavía no lo sé llenar solo/i);
    // Lo que NO puede decir: que el portal pide cuenta (mandaría a buscar una
    // contraseña que no existe) ni que se intentó y falló (no se intentó).
    expect(texto).not.toMatch(/pide cuenta/i);
    expect(texto).not.toMatch(/se intentó solo/i);
  });

  it('con cuenta gana sobre sin-adaptador: la sesión es el obstáculo real', () => {
    const r = enrutar(armar(g({ extra: CON_CUENTA }), HOY), false);
    if (r.via === 'mensaje') expect(r.motivo).toBe('requiere_cuenta');
  });

  it('vencido gana sobre sin-adaptador: ya no se puede, y no se manda a nadie', () => {
    const r = enrutar(armar(g({ fecha: '2026-05-01', extra: SIN_CUENTA }), HOY), false);
    expect(r.via).toBe('incompleto');
  });

  it('vencido → no se manda a nadie a intentar lo imposible', () => {
    const r = enrutar(armar(g({ fecha: '2026-05-01', extra: SIN_CUENTA }), HOY), true);
    expect(r.via).toBe('incompleto');
    if (r.via === 'incompleto') expect(r.falta.join(' ')).toMatch(/venci/);
  });
});

describe('mensajeParaEncargado', () => {
  it('lleva la liga y los campos, y NO repite los datos del receptor', () => {
    const t = armar(g({ extra: CON_CUENTA }), HOY);
    const r = enrutar(t, true);
    if (r.via !== 'mensaje') throw new Error('esperaba mensaje');
    const m = mensajeParaEncargado(t, r);
    expect(m).toContain('oxxogas');
    // El RFC de la flota es el mismo en todos los portales y él ya lo tiene:
    // repetirlo en cada mensaje entierra lo que sí cambia.
    expect(m).not.toMatch(/RFC del receptor|razón social/i);
    expect(m).toMatch(/pide cuenta/);
  });

  it('marca cuando vence hoy, que es lo único que cambia la conducta', () => {
    const t = armar(g({ fecha: '2026-08-31', extra: CON_CUENTA }), '2026-08-31');
    const r = enrutar(t, true);
    if (r.via !== 'mensaje') throw new Error('esperaba mensaje');
    expect(mensajeParaEncargado(t, r)).toMatch(/VENCE HOY/);
  });
});

describe('repartir', () => {
  it('separa los tres caminos', () => {
    const lista = [
      armar(g({ id: 'a', extra: SIN_CUENTA }), HOY),
      armar(g({ id: 'b', extra: CON_CUENTA }), HOY),
      armar(g({ id: 'c', extra: {} }), HOY),
    ];
    const r = repartir(lista, () => true);
    expect(r.automaticos).toHaveLength(1);
    expect(r.mensajes).toHaveLength(1);
    expect(r.incompletos).toHaveLength(1);
  });
});
