import { describe, it, expect, vi } from 'vitest';
import {
  claveCorreo, correoDeEscalamiento, debeRespaldarPorCorreo, hashCorreo, respaldarPorCorreo, reintentarCorreosVencidos, unirDestinatarios,
  validarDirector, telefonoDeDirector, TEXTO_SIN_CONFIGURAR,
} from './respaldo_correo';
import { escenario } from './repo.fixture';
import { AHORA, T1 } from './datos.fixture';
import { armarHtml, aTextoPlano } from '@/lib/correo/plantilla';
import type { ResultadoEnvioConFallback } from '@/lib/meta/enviar_con_fallback';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const rechazo = (extra: Partial<Extract<ResultadoEnvioConFallback, { ok: false }>> = {}): ResultadoEnvioConFallback => ({
  ok: false, motivo: 'plantilla_rechazada', mensaje: 'x', fueraDeVentana: true, reintentable: false, ventana: 'cerrada', ...extra,
});

describe('debeRespaldarPorCorreo', () => {
  it('un aviso que no salió (plantilla sin aprobar, ventana cerrada, rechazo) pide respaldo', () => {
    expect(debeRespaldarPorCorreo(rechazo())).toBe(true);
    expect(debeRespaldarPorCorreo(rechazo({ motivo: 'ventana_cerrada_plantilla_no_aprobada_texto' }))).toBe(true);
  });
  it('lo que salió, o va en camino por la cola de reintento, NO se duplica por correo', () => {
    expect(debeRespaldarPorCorreo({ ok: true, via: 'plantilla', id: 'w', motivo: 'ventana_cerrada', ventana: 'cerrada' })).toBe(false);
    expect(debeRespaldarPorCorreo(rechazo({ reintentable: true }))).toBe(false);
    expect(debeRespaldarPorCorreo(rechazo({ encolado: true }))).toBe(false);
  });
});

describe('llave y huella del correo', () => {
  it('la llave es estable, distinta por persona y por aviso, y no contiene el correo', () => {
    const k = claveCorreo('conv:1:n1', 'Ana@Flota.mx');
    expect(k).toBe(claveCorreo('conv:1:n1', ' ana@flota.mx '));
    expect(k).not.toBe(claveCorreo('conv:1:n1', 'beto@flota.mx'));
    expect(k).not.toBe(claveCorreo('conv:1:n2', 'ana@flota.mx'));
    expect(k).not.toContain('ana');
    expect(k.length).toBeLessThanOrEqual(200);
    expect(hashCorreo('ana@flota.mx')).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('correoDeEscalamiento', () => {
  const c = correoDeEscalamiento({ cliente: 'Acme  SA', motivo: 'sin_respuesta', minutos: 45, nivel: 2 });
  it('dice el hecho en el asunto, lleva la liga al tablero y el porqué', () => {
    expect(c.asunto).toBe('Vigía de servicio: Acme SA necesita atención (nivel 2)');
    expect(c.boton?.href).toMatch(/\/dashboard\/agentes\/vigia$/);
    expect(c.porQueLoRecibes).toContain('lista de directores');
    expect(JSON.stringify(c.parrafos)).toContain('45 minutos sin respuesta');
  });
  it('se arma a HTML y texto plano, y escapa lo que viene de la base', () => {
    const peligroso = correoDeEscalamiento({ cliente: '<script>alert(1)</script>', motivo: 'molestia', minutos: 0, nivel: 1 });
    expect(armarHtml(peligroso)).not.toContain('<script>alert(1)</script>');
    expect(aTextoPlano(c)).toContain('Acme SA');
  });
  it('no lleva teléfonos ni correos', () => {
    expect(JSON.stringify(c)).not.toMatch(/\d{10}/);
  });
});

describe('unirDestinatarios', () => {
  it('junta los dos canales de la misma persona y quita repetidos por teléfono o por correo', () => {
    const lista = unirDestinatarios([
      { userId: 'u1', directorId: null, nombre: null, telefono: '5215577770001', correo: null },
      { userId: null, directorId: 'd1', nombre: 'Ana', telefono: '525577770001', correo: 'Ana@Flota.mx' },
      { userId: null, directorId: 'd2', nombre: 'Beto', telefono: null, correo: 'ana@flota.mx' },
      { userId: null, directorId: 'd3', nombre: 'Carla', telefono: null, correo: 'carla@flota.mx' },
    ]);
    expect(lista).toHaveLength(2);
    expect(lista[0]).toMatchObject({ telefono: '525577770001', correo: 'ana@flota.mx', userId: 'u1', directorId: 'd1', nombre: 'Ana' });
    expect(lista[1].correo).toBe('carla@flota.mx');
  });
});

describe('validarDirector', () => {
  const ok = { nivel: '1', nombre: '  Ana   Pérez ', telefono: '55 7777 0001', correo: ' ana@flota.mx ' };
  it('normaliza nombre, teléfono (52 + 10 dígitos) y correo', () => {
    expect(validarDirector(ok)).toEqual({ ok: true, valor: { nivel: 1, nombre: 'Ana Pérez', telefono: '525577770001', correo: 'ana@flota.mx' } });
  });
  it('acepta solo teléfono o solo correo', () => {
    expect(validarDirector({ ...ok, correo: '' })).toMatchObject({ ok: true, valor: { correo: null } });
    expect(validarDirector({ ...ok, telefono: '' })).toMatchObject({ ok: true, valor: { telefono: null } });
  });
  it('rechaza lo que la base rechazaría, con un mensaje para la pantalla', () => {
    for (const malo of [
      { ...ok, nivel: '3' }, { ...ok, nivel: '' }, { ...ok, nombre: '   ' }, { ...ok, nombre: 'x'.repeat(121) },
      { ...ok, telefono: '', correo: '' }, { ...ok, telefono: '12345' }, { ...ok, correo: 'sin-arroba' }, { ...ok, correo: `${'a'.repeat(250)}@x.mx` },
    ]) {
      const r = validarDirector(malo);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(5);
    }
  });
  it('el teléfono acepta 10 dígitos, con 52 y con 521', () => {
    expect(telefonoDeDirector('5577770001')).toBe('525577770001');
    expect(telefonoDeDirector('+52 1 55 7777 0001')).toBe('525577770001');
    expect(telefonoDeDirector('7777')).toBeNull();
  });
});

describe('respaldarPorCorreo', () => {
  const datos = { cliente: 'Acme', motivo: 'sin_respuesta' as const, minutos: 40, nivel: 1 as const };
  async function preparar() {
    const { repo } = escenario({ respaldoCorreo: true });
    repo.reloj = () => AHORA;
    // una conversación de T1
    const contacto = [...repo.contactos.values()][0];
    await repo.recibir({ tenantId: T1, contactoId: contacto.id, wamid: 'w1', tipo: 'texto', texto: 'hola', ahora: AHORA });
    const conv = [...repo.conversaciones.values()][0];
    return { repo, conv };
  }
  const entrada = (convId: string) => ({ tenantId: T1, conversacionId: convId, clave: 'k1', nivel: 1 as const, directorId: null, correo: 'ana@flota.mx', datos });

  it('envía con la llave de idempotencia, cierra y deja el evento', async () => {
    const { repo, conv } = await preparar();
    const enviarCorreo = vi.fn(async () => ({ ok: true as const, id: 're_1' }));
    expect(await respaldarPorCorreo(entrada(conv.id), { repo, enviarCorreo })).toBe('enviado');
    expect(enviarCorreo).toHaveBeenCalledWith('ana@flota.mx', expect.objectContaining({ asunto: expect.stringContaining('Acme') }), { idempotencyKey: 'k1' });
    expect(repo.correos[0].estado).toBe('enviado');
    expect(repo.eventosDe('correo_enviado')).toHaveLength(1);
  });
  it('sin configurar: lo dice con todas sus letras y no lanza', async () => {
    const { repo, conv } = await preparar();
    const r = await respaldarPorCorreo(entrada(conv.id), { repo, enviarCorreo: async () => ({ ok: false, motivo: 'sin_configurar' }) });
    expect(r).toBe('sin_configurar');
    expect(repo.correos[0].detalle).toBe(TEXTO_SIN_CONFIGURAR);
    expect(TEXTO_SIN_CONFIGURAR).toContain('falta configuración');
  });
  it('un segundo intento de la misma llave no manda nada (duplicado)', async () => {
    const { repo, conv } = await preparar();
    const enviarCorreo = vi.fn(async () => ({ ok: true as const, id: 'x' }));
    await respaldarPorCorreo(entrada(conv.id), { repo, enviarCorreo });
    expect(await respaldarPorCorreo(entrada(conv.id), { repo, enviarCorreo })).toBe('duplicado');
    expect(enviarCorreo).toHaveBeenCalledTimes(1);
  });
  it('si no puede cerrar (arriendo perdido) no lanza', async () => {
    const { repo, conv } = await preparar();
    repo.fallaEn.cerrarCorreo = true;
    await expect(respaldarPorCorreo(entrada(conv.id), { repo, enviarCorreo: async () => ({ ok: true, id: 'x' }) })).resolves.toBe('enviado');
  });
  it('reintentarCorreosVencidos: sin la tabla (la lectura lanza) devuelve 0 en vez de tumbar el cron', async () => {
    const { repo } = await preparar();
    repo.fallaEn.correosVencidos = true;
    expect(await reintentarCorreosVencidos({ repo }, 5)).toBe(0);
  });
});
