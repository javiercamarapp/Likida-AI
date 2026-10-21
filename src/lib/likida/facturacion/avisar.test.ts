import { describe, it, expect, vi, beforeEach } from 'vitest';
import { armarAviso, avisarPorFacturar } from './avisar';
import { armar } from './pendientes';

// ── Mocks SOLO para `avisarPorFacturar` (el cableado). `armarAviso` es pura y
// sus pruebas de abajo no tocan nada de esto. `armar` sigue siendo el real: el
// spread del original solo sustituye `getPorFacturar`.
const sendText = vi.fn();
const sendTemplate = vi.fn();
const getPorFacturar = vi.fn();
const insert = vi.fn(async () => ({ error: null }));
const cuentasCompartidas = vi.fn(async (_tenantId: string) => new Set<string>());

vi.mock('@/lib/meta/client', () => ({
  sendText: (...a: unknown[]) => sendText(...a),
  sendTemplate: (...a: unknown[]) => sendTemplate(...a),
  motivoDeFalloWhatsApp: () => 'la plantilla no está aprobada (prueba)',
}));
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({ from: () => ({ insert } as unknown) }),
}));
vi.mock('./cuentas', () => ({
  cuentasCompartidas: (tenantId: string) => cuentasCompartidas(tenantId),
}));
vi.mock('./pendientes', async (original) => ({
  ...(await original<Record<string, unknown>>()),
  getPorFacturar: (...a: unknown[]) => getPorFacturar(...a),
}));

// ═══════════════════════════════════════════════════════════════════════════
// EL AVISO POR WHATSAPP — cierra el camino que empieza en la foto del ticket.
//
// Se leyó la liga del ticket, se reconoció el portal, se calculó el plazo, y el
// aviso sale por el MISMO canal por el que entró la foto.
//
// LAS TRES REGLAS QUE ESTE ARCHIVO FIJA, y las tres existen porque el modo de
// falla es que el encargado deje de leer los avisos:
//
//   1. UNO por flota, no uno por ticket. Un viaje de 22 comprobantes generaría
//      21 mensajes; nadie lee 21, y WhatsApp cobra cada plantilla.
//   2. No se avisa de lo que la máquina hace sola. Avisar de algo que ya se
//      está haciendo entrena a ignorar el aviso.
//   3. No se avisa de lo vencido. Ya no se puede facturar: mandar a alguien a
//      intentar lo imposible quema el canal.
// ═══════════════════════════════════════════════════════════════════════════

const HOY = '2026-08-04';
const g = (o: Record<string, unknown>) => ({
  id: String(o.id), concepto: String(o.concepto ?? 'diesel'), monto: Number(o.monto ?? 400),
  fecha: (o.fecha as string) ?? null, folio: (o.folio as string) ?? '12345',
  rfc_emisor: null, cfdi_uuid: null, ocr_extra: (o.extra ?? {}) as Record<string, unknown>,
});

// OXXO Gas pide cuenta → va por mensaje. Enerser no → lo hace la máquina.
const CON_CUENTA = { urlFacturacion: 'https://facturacion.oxxogas.com/', webId: '650', estacion: 'E1' };
const SIN_CUENTA = { urlFacturacion: 'https://facturacion.enerser.com.mx/', webId: '650', estacion: 'E1' };

/** «Sí hay adaptador para ese portal». El default real lo saca de
 *  `PORTALES_CONOCIDOS`, y con un solo adaptador escrito ese default haría que
 *  estas pruebas midieran otra cosa. Se declara el supuesto en vez de heredarlo. */
const HAY_ROBOT = () => true;
const NO_HAY_ROBOT = () => false;

describe('armarAviso', () => {
  it('NO avisa de lo que la máquina puede hacer sola', () => {
    const t = [armar(g({ id: '1', fecha: '2026-08-04', extra: SIN_CUENTA }), HOY)];
    expect(armarAviso(t, HAY_ROBOT).cuantos).toBe(0);
  });

  // ── Y EL OTRO LADO, QUE ERA EL SILENCIO (20-ago-2026) ──────────────────
  //
  // El mismo ticket, cuando NADIE sabe operar ese portal, tiene que llegarle a
  // la persona: el portal existe, los datos están leídos y el plazo corre. Lo
  // que faltaba era el adaptador, y de eso el encargado no se enteraba.
  it('pero SÍ avisa cuando no hay adaptador: si no, no lo factura nadie', () => {
    const t = [armar(g({ id: '1', fecha: '2026-08-04', extra: SIN_CUENTA }), HOY)];
    const a = armarAviso(t, NO_HAY_ROBOT);
    expect(a.cuantos, 'sin este aviso el ticket se vence en silencio').toBe(1);
    // Y con lo que hace falta para cerrarlo desde el teléfono: la liga y el
    // campo que ESE portal pide (Enerser pide el número de referencia, o sea
    // el folio — no todos los portales piden lo mismo).
    expect(a.texto).toContain('enerser');
    expect(a.texto).toContain('12345');
    expect(a.texto).toMatch(/todavía no lo sé llenar solo/i);
  });

  it('avisa de los que piden cuenta, que son los que necesitan a la persona', () => {
    const t = [armar(g({ id: '1', fecha: '2026-08-04', extra: CON_CUENTA }), HOY)];
    const a = armarAviso(t);
    expect(a.cuantos).toBe(1);
    expect(a.texto).toContain('sin factura');
  });

  it('NO avisa de lo vencido — ya no se puede hacer nada', () => {
    const t = [armar(g({ id: '1', fecha: '2026-05-01', extra: CON_CUENTA }), HOY)];
    expect(armarAviso(t).cuantos).toBe(0);
  });

  it('pone lo que URGE primero y lo marca', () => {
    const t = [
      armar(g({ id: 'tranquilo', concepto: 'caseta', fecha: '2026-08-25', extra: CON_CUENTA }), '2026-08-05'),
      armar(g({ id: 'urgente', concepto: 'hospedaje', fecha: '2026-08-31', extra: CON_CUENTA }), '2026-08-30'),
    ];
    const a = armarAviso(t);
    // El urgente aparece antes que el tranquilo en el cuerpo del mensaje.
    expect(a.texto.indexOf('hospedaje')).toBeLessThan(a.texto.indexOf('caseta'));
    expect(a.texto).toMatch(/vence/i);
  });

  it('con más de 6 no los lista todos: dice cuántos faltan', () => {
    // Listar 20 hace que no se lea ninguno. Decir "y 14 más" es honesto y cabe
    // en la pantalla de un teléfono.
    const t = Array.from({ length: 9 }, (_, i) =>
      armar(g({ id: `t${i}`, fecha: '2026-08-20', extra: CON_CUENTA }), HOY));
    const a = armarAviso(t);
    expect(a.cuantos).toBe(9);
    expect(a.texto).toMatch(/y 3 más/);
  });

  it('sin nada que hacer NO arma mensaje — no se gasta una plantilla en vacío', () => {
    expect(armarAviso([]).texto).toBe('');
  });

  // HALLAZGO ALTO (auditoría adversarial): `armarAviso` evaluaba `cuentaCompartida`
  // SIEMPRE como `false` (el default de `enrutar`), a diferencia de la decisión REAL
  // de facturación (`facturarAlVuelo`/`facturarLoteAlVuelo`), que sí consulta
  // `cuentasCompartidas(tenantId)`. Para un comercio con `requiereCuenta: true` y
  // cuenta YA compartida, el aviso podía decir «pide cuenta» de un ticket que la
  // máquina ya puede facturar sola.
  it('con la cuenta compartida y robot escrito, deja de avisar: ya lo hace la máquina', () => {
    const t = [armar(g({ id: '1', fecha: '2026-08-04', extra: CON_CUENTA }), HOY)];
    // Sin pasar `cuentaCompartida` (como antes del arreglo): sigue avisando.
    expect(armarAviso(t, HAY_ROBOT).cuantos).toBe(1);
    // Con `cuentaCompartida` en true para oxxo_gas: el ticket deja de necesitar
    // a la persona, igual que ve `facturarAlVuelo`.
    const a = armarAviso(t, HAY_ROBOT, (clave) => clave === 'oxxo_gas');
    expect(a.cuantos).toBe(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EL CABLEADO: `avisarPorFacturar` manda el TEXTO COMPLETO primero.
//
// Hasta el 20-ago-2026 el texto de `armarAviso` —la liga, los campos, el
// plazo— se armaba y SE TIRABA: lo único que salía era la plantilla con el
// conteo. El mismo patrón que este repo ya pagó en `escalar_viaje.ts`
// (`armarAvisoJefe` escrito, probado y sin un llamador). Estas pruebas
// ejercitan la función real con Meta y la base sustituidas, no el texto del
// código fuente.
// ═══════════════════════════════════════════════════════════════════════════
describe('avisarPorFacturar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Un ticket de OXXO Gas: pide cuenta, así que va con la persona y el aviso
    // tiene cuerpo. La fecha cae dentro del mes de HOY para que no esté vencido.
    getPorFacturar.mockResolvedValue([armar(g({ id: '1', fecha: '2026-08-04', extra: CON_CUENTA }), HOY)]);
    cuentasCompartidas.mockResolvedValue(new Set());
  });

  it('dentro de la ventana: sale el texto con la liga y NO se gasta plantilla', async () => {
    sendText.mockResolvedValue('wamid-texto');
    const r = await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(r.enviado).toBe(true);
    expect(r.via).toBe('texto');
    // Lo que hace útil al aviso: la liga del portal viaja en el mensaje.
    expect(sendText.mock.calls[0][1]).toContain('oxxogas');
    expect(sendTemplate).not.toHaveBeenCalled();
  });

  it('fuera de la ventana: Meta rechaza el texto y entra la plantilla', async () => {
    sendText.mockResolvedValue(null);
    sendTemplate.mockResolvedValue({ ok: true, id: 'wamid-plantilla' });
    const r = await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(r.enviado).toBe(true);
    expect(r.via).toBe('plantilla');
    expect(sendTemplate).toHaveBeenCalledOnce();
  });

  // AUDITORÍA 18 · A1 — la constancia decía entidad `gasto` con el id del
  // TENANT, y no firmaba actor: quien copiaba ese id para buscar el gasto no
  // lo encontraba. El aviso es un lote por flota que manda el cron.
  it('la constancia en bitácora es de la FLOTA, con el id de la flota, y la firma el sistema', async () => {
    sendText.mockResolvedValue('wamid-texto');
    await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(insert).toHaveBeenCalledOnce();
    expect((insert.mock.calls[0] as unknown[])[0]).toEqual({
      tenant_id: 't1',
      actor_id: null,
      actor_email: null,
      accion: 'facturacion.aviso_enviado',
      entidad: 'tenant',
      entidad_id: 't1',
      detalle: { tickets: 1, wamid: 'wamid-texto', via: 'texto' },
    });
  });

  it('si NO salió, no se anota nada: la bitácora dice lo que pasó, no lo que se intentó', async () => {
    sendText.mockResolvedValue(null);
    sendTemplate.mockResolvedValue({ ok: false, error: 'x', codigo: 132001 });
    await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(insert).not.toHaveBeenCalled();
  });

  it('los DOS caminos caídos: se dice el motivo, no se afirma enviado', async () => {
    sendText.mockResolvedValue(null);
    sendTemplate.mockResolvedValue({ ok: false, error: 'x', codigo: 132001 });
    const r = await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(r.enviado).toBe(false);
    expect(r.motivo).toBeTruthy();
    // El texto se devuelve igual: es lo que la pantalla enseña para reenviar a mano.
    expect(r.texto).toContain('oxxogas');
  });

  // HALLAZGO ALTO (auditoría adversarial): `avisarPorFacturar` nunca consultaba
  // `cuentasCompartidas(tenantId)` antes de armar el aviso real por WhatsApp. Sin
  // adaptador escrito para oxxo_gas en este entorno, la cuenta compartida no vuelve
  // automático al ticket (sigue sin quién lo opere), pero SÍ cambia la premisa que
  // el aviso le explica al encargado: deja de decir «pide cuenta» (ya no es cierto)
  // y pasa a decir que falta el robot — exactamente lo que `enrutar` distingue.
  it('consulta la MISMA cuenta compartida que ve la decisión real de facturación', async () => {
    cuentasCompartidas.mockResolvedValue(new Set(['oxxo_gas']));
    sendText.mockResolvedValue('wamid-texto');
    const r = await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(cuentasCompartidas).toHaveBeenCalledWith('t1');
    expect(r.enviado).toBe(true);
    expect(r.tickets).toBe(1);
    expect(r.texto).not.toMatch(/pide cuenta/);
    expect(r.texto).toMatch(/todavía no lo sé llenar solo/i);
  });

  it('sin cuenta compartida, no cambia nada: sigue avisando como antes', async () => {
    cuentasCompartidas.mockResolvedValue(new Set());
    sendText.mockResolvedValue('wamid-texto');
    const r = await avisarPorFacturar({ tenantId: 't1', telefono: '5219990000001', hoy: HOY });
    expect(r.enviado).toBe(true);
    expect(r.tickets).toBe(1);
  });
});
