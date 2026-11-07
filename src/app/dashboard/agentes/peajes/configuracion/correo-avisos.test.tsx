import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { crearDbFalsa, type DbFalsa } from '@/lib/likida/peajes/db_falsa.test.util';

let db: DbFalsa;
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => db.cliente }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const A = await import('./acciones-correo-avisos');
const R = await import('@/lib/likida/peajes/repo');
const { SeccionCorreoAvisos } = await import('./correo-avisos');
const { CONFIG_CORREO_AVISOS_DEFAULT, MAX_DESTINATARIOS_CORREO_AVISOS } = await import('@/lib/likida/peajes/aviso_correo');

const T = 'tenant-1';
const OTRO = 'tenant-2';
const admin = { rol: 'flota_admin', tenantId: T };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const nada = async () => {};
const filas = (n: number) => Array.from({ length: n }, (_, i) => `persona${i}@flota.test`).join('\n');

beforeEach(() => { db = crearDbFalsa({}); });

describe('guardar los avisos por correo', () => {
  it('guarda destinatarios (uno por línea o con coma), fecha de corte e interruptor', async () => {
    const r = await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: 'ana@flota.test\nluis@flota.test, ana@flota.test', correo_corte: '2026-10-01', correo_activo: '1' }));
    expect(r).toMatchObject({ ok: true });
    expect(await R.leerCorreoAvisos(T)).toMatchObject({ activo: true, destinatarios: ['ana@flota.test', 'luis@flota.test'], noEnviarAntes: '2026-10-01' });
  });

  it('el interruptor nace APAGADO: sin la marca guarda apagado y no exige destinatarios', async () => {
    expect(await R.leerCorreoAvisos(T)).toEqual(CONFIG_CORREO_AVISOS_DEFAULT);
    const r = await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: 'ana@flota.test', correo_corte: '2026-10-01' }));
    expect(r).toMatchObject({ ok: true });
    expect((await R.leerCorreoAvisos(T)).activo).toBe(false);
  });

  it('un correo mal escrito se rechaza con mensaje llano y no escribe nada', async () => {
    const r = await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: 'ana@flota.test\nesto-no-es-correo', correo_corte: '2026-10-01' }));
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('no parece un correo válido');
    // No repite lo tecleado (el motivo viaja en la URL de retorno) y señala qué dirección revisar.
    expect((r as { error: string }).error).not.toContain('esto-no-es-correo');
    expect((r as { error: string }).error).toContain('dirección 2');
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });

  it('10 direcciones largas con saltos CRLF caben sin truncar la última', async () => {
    const largas = Array.from({ length: 10 }, (_, i) => `${'x'.repeat(60)}${i}@flota-con-dominio-largo.test`);
    const r = await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: largas.join('\r\n') }));
    expect(r).toMatchObject({ ok: true });
    expect((await R.leerCorreoAvisos(T)).destinatarios).toEqual(largas);
  });

  it('el límite es de 10 destinatarios: 10 pasan, 11 no', async () => {
    expect(MAX_DESTINATARIOS_CORREO_AVISOS).toBe(10);
    expect(await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: filas(10) }))).toMatchObject({ ok: true });
    const r = await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: filas(11) }));
    expect(r).toMatchObject({ ok: false, error: 'Máximo 10 destinatarios.' });
    expect((await R.leerCorreoAvisos(T)).destinatarios).toHaveLength(10);
  });

  it.each(['2026-13-01', '2026-02-30', 'ayer', '01/10/2026'])('la fecha de corte inválida «%s» se rechaza', async (corte) => {
    const r = await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: 'ana@flota.test', correo_corte: corte }));
    expect(r).toMatchObject({ ok: false, error: 'La fecha de corte debe ser AAAA-MM-DD.' });
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });

  it('no se enciende sin fecha de corte ni sin destinatarios', async () => {
    expect(await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: 'ana@flota.test', correo_activo: '1' }))).toMatchObject({ ok: false });
    expect(await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_corte: '2026-10-01', correo_activo: '1' }))).toMatchObject({ ok: false });
    expect((await R.leerCorreoAvisos(T)).activo).toBe(false);
  });

  it('conserva el asunto ya guardado y el resto de la configuración de la flota', async () => {
    await R.guardarConfigAvisos(T, { plazo: { meses: 5 } });
    await R.guardarCorreoAvisos(T, { activo: false, destinatarios: [], asunto: 'Asunto de la flota' });
    await A.guardarCorreoAvisosDeFormulario(admin, T, fd({ correo_destinatarios: 'ana@flota.test' }));
    expect((await R.leerCorreoAvisos(T)).asunto).toBe('Asunto de la flota');
    expect((await R.leerConfigPeajes(T)).avisos.plazo.meses).toBe(5);
  });

  it('un rol sin permiso de administración no guarda ni prueba', async () => {
    for (const rol of ['operador', 'chofer', 'vendedor', 'nomina']) {
      const r = await A.guardarCorreoAvisosDeFormulario({ rol, tenantId: T }, T, fd({ correo_destinatarios: 'ana@flota.test' }));
      expect(r).toMatchObject({ ok: false });
    }
    const enviar = vi.fn();
    expect(await A.enviarPruebaDeFormulario({ rol: 'operador', tenantId: T }, T, { enviar, configurado: () => true })).toMatchObject({ ok: false });
    expect(enviar).not.toHaveBeenCalled();
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
  });

  it('una flota ajena no puede guardar ni probar sobre otra flota (un superadmin sí)', async () => {
    const ajena = { rol: 'flota_admin', tenantId: OTRO };
    expect(await A.guardarCorreoAvisosDeFormulario(ajena, T, fd({ correo_destinatarios: 'ana@flota.test' }))).toMatchObject({ ok: false, error: 'Esta configuración no es de tu flota.' });
    expect(await A.enviarPruebaDeFormulario(ajena, T, { enviar: vi.fn(), configurado: () => true })).toMatchObject({ ok: false });
    expect(db.tablas.peaje_atipico_config ?? []).toHaveLength(0);
    expect(await A.guardarCorreoAvisosDeFormulario({ rol: 'superadmin', tenantId: null }, T, fd({ correo_destinatarios: 'ana@flota.test' }))).toMatchObject({ ok: true });
    expect((await R.leerCorreoAvisos(OTRO)).destinatarios).toEqual([]);
  });
});

describe('enviar correo de prueba', () => {
  const ok = { ok: true as const, id: 're_1' };
  beforeEach(async () => { await R.guardarCorreoAvisos(T, { activo: false, destinatarios: ['ana@flota.test', 'luis@flota.test'] }); });

  it('manda uno por destinatario guardado con el mismo canal sobrio y una llave estable (doble del proveedor)', async () => {
    const enviar = vi.fn(async () => ok);
    const r = await A.enviarPruebaDeFormulario(admin, T, { enviar, configurado: () => true, ahora: () => 1_800_000_000_000 });
    expect(r).toMatchObject({ ok: true });
    // El éxito no promete un correo nuevo si la prueba se repite dentro de la ventana de la llave.
    expect((r as { mensaje: string }).mensaje).toContain('hace menos de 10 minutos, no se manda otra');
    expect(enviar).toHaveBeenCalledTimes(2);
    const [para1, correo, op1] = enviar.mock.calls[0] as unknown as [string, { asunto: string; parrafos: string[] }, { sobrio: boolean; idempotencyKey: string }];
    expect(para1).toBe('ana@flota.test');
    expect(op1.sobrio).toBe(true);
    expect(correo.asunto).toBe('Prueba: aviso de Peajes');
    expect(JSON.stringify(correo)).not.toMatch(/whatsapp/i);
    // mismo minuto ventana = misma llave (un doble clic no duplica); otra ventana = otra llave
    const otra = vi.fn(async () => ok);
    await A.enviarPruebaDeFormulario(admin, T, { enviar: otra, configurado: () => true, ahora: () => 1_800_000_000_000 + 30_000 });
    expect((otra.mock.calls[0] as unknown as [string, unknown, { idempotencyKey: string }])[2].idempotencyKey).toBe(op1.idempotencyKey);
    const tarde = vi.fn(async () => ok);
    await A.enviarPruebaDeFormulario(admin, T, { enviar: tarde, configurado: () => true, ahora: () => 1_800_000_000_000 + 11 * 60_000 });
    expect((tarde.mock.calls[0] as unknown as [string, unknown, { idempotencyKey: string }])[2].idempotencyKey).not.toBe(op1.idempotencyKey);
    expect(op1.idempotencyKey).not.toContain('ana@flota.test');
  });

  it('FAIL-CERRADO: sin el servicio de correo no intenta enviar y lo dice con palabras llanas', async () => {
    const enviar = vi.fn(async () => ok);
    const r = await A.enviarPruebaDeFormulario(admin, T, { enviar, configurado: () => false });
    expect(r).toMatchObject({ ok: false });
    expect((r as { error: string }).error).toContain('todavía no está activado');
    expect((r as { error: string }).error).not.toMatch(/resend|\bapi\b|clave|llave|RESEND_API_KEY/i);
    expect(enviar).not.toHaveBeenCalled();
  });

  it('si el proveedor contesta «sin configurar», tampoco cuenta como enviado', async () => {
    const r = await A.enviarPruebaDeFormulario(admin, T, { enviar: async () => ({ ok: false, motivo: 'sin_configurar' }), configurado: () => true });
    expect(r).toMatchObject({ ok: false });
  });

  it('sin destinatarios guardados no manda nada', async () => {
    await R.guardarCorreoAvisos(T, { activo: false, destinatarios: [] });
    const enviar = vi.fn(async () => ok);
    expect(await A.enviarPruebaDeFormulario(admin, T, { enviar, configurado: () => true })).toMatchObject({ ok: false });
    expect(enviar).not.toHaveBeenCalled();
  });

  it('un rechazo parcial se dice sin mostrar la dirección completa; todo rechazado es error', async () => {
    let n = 0;
    const parcial = await A.enviarPruebaDeFormulario(admin, T, { enviar: async () => (n++ === 0 ? ok : { ok: false, motivo: 'rechazado', detalle: 'x', status: 422 }), configurado: () => true });
    expect(parcial).toMatchObject({ ok: true });
    expect((parcial as { mensaje: string }).mensaje).toContain('No se pudo mandar a');
    expect((parcial as { mensaje: string }).mensaje).not.toContain('luis@flota.test');
    const nada2 = await A.enviarPruebaDeFormulario(admin, T, { enviar: async () => ({ ok: false, motivo: 'red', detalle: 'x' }), configurado: () => true });
    expect(nada2).toMatchObject({ ok: false });
  });

  it('la prueba no enciende el aviso ni cambia la configuración', async () => {
    const antes = JSON.stringify(await R.leerCorreoAvisos(T));
    await A.enviarPruebaDeFormulario(admin, T, { enviar: async () => ok, configurado: () => true });
    expect(JSON.stringify(await R.leerCorreoAvisos(T))).toBe(antes);
  });
});

describe('la sección en pantalla', () => {
  const acciones = { guardar: nada, enviarPrueba: nada };
  it('una flota nueva ve el interruptor APAGADO, sin destinatarios y con el tope de 10', () => {
    const html = renderToStaticMarkup(<SeccionCorreoAvisos datos={{ config: CONFIG_CORREO_AVISOS_DEFAULT, puedeAdministrar: true, servicioActivo: true, acciones }} />);
    expect(html).not.toMatch(/name="correo_activo"[^>]*checked/);
    expect(html).toContain('hasta 10');
    expect(html).toContain('Enviar correo de prueba');
    expect(html).toMatch(/<label[^>]*>.*Correos que reciben el aviso/);
    expect(html).toMatch(/aria-label="Fecha de corte/);
    expect(html).not.toMatch(/whatsapp/i);
  });
  it('pinta lo guardado y avisa honestamente si el envío de correos no está activado', () => {
    const html = renderToStaticMarkup(<SeccionCorreoAvisos datos={{ config: { activo: true, destinatarios: ['ana@flota.test'], asunto: null, noEnviarAntes: '2026-10-01' }, puedeAdministrar: true, servicioActivo: false, acciones }} />);
    expect(html).toMatch(/name="correo_activo"[^>]*checked/);
    expect(html).toContain('ana@flota.test');
    expect(html).toContain('value="2026-10-01"');
    expect(html).toContain('no está activado en esta cuenta');
  });
  it('sin permiso o sin lectura no muestra formularios', () => {
    const sin = renderToStaticMarkup(<SeccionCorreoAvisos datos={{ config: CONFIG_CORREO_AVISOS_DEFAULT, puedeAdministrar: false, servicioActivo: true, acciones }} />);
    expect(sin).not.toContain('<form');
    const nula = renderToStaticMarkup(<SeccionCorreoAvisos datos={{ config: null, puedeAdministrar: true, servicioActivo: true, acciones }} />);
    expect(nula).not.toContain('<form');
  });
});
