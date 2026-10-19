import { describe, it, expect, vi, beforeEach } from 'vitest';

// ═══════════════════════════════════════════════════════════════════════════
// `guardarSftpPeajes` (0843) — TODA la validación tiene que pasar ANTES de
// tocar la base o el cofre: una credencial a medio guardar (host sin usuario,
// huella sin forma) es peor que rechazarla aquí. Reusa los MISMOS helpers que
// `tabla_propia/sftp.ts` (ya probados en `sftp.test.ts`): aquí solo se prueba
// el ENSAMBLE — qué entrada guarda qué columnas, y qué entrada nunca llega a
// escribir nada.
// ═══════════════════════════════════════════════════════════════════════════

const registros: Array<{ tabla: string; op: string; payload: unknown }> = [];
let existeFila = false;
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      b.select = () => b;
      b.eq = () => b;
      b.maybeSingle = async () => ({ data: existeFila ? { tenant_id: 't-1' } : null, error: null });
      b.update = (p: unknown) => { registros.push({ tabla, op: 'update', payload: p }); return b; };
      b.insert = (p: unknown) => { registros.push({ tabla, op: 'insert', payload: p }); return b; };
      // `update`/`insert` de guardarEntradas no esperan el resultado por sus campos, solo `{error}`.
      b.then = (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res);
      return b;
    },
  }),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

let cofreOk = true;
const cifrarMock = vi.fn((v: Record<string, string | undefined>) => `v1.cifrado.de.${JSON.stringify(v)}`);
vi.mock('../conectores/cofre', () => ({ cifrar: (v: Record<string, string | undefined>) => cifrarMock(v), cofreConfigurado: () => cofreOk, descifrar: () => ({}) }));

const { guardarSftpPeajes, apagarSftpPeajes, borrarCredencialSftp } = await import('./datos');

const HUELLA = 'SHA256:' + 'A'.repeat(43);
const BASE = { url: 'sftp://s.ejemplo.com/entrega/corte-pase.xlsx', usuario: 'likida', clave: 'clave-secreta', huellas: HUELLA, intervaloMin: 60 };

beforeEach(() => { registros.length = 0; existeFila = false; cofreOk = true; cifrarMock.mockClear(); });

describe('guardarSftpPeajes — feliz', () => {
  it('con contraseña: guarda host/puerto/usuario/ruta/huellas y cifra la credencial', async () => {
    const r = await guardarSftpPeajes('t-1', BASE);
    expect(r).toEqual({ ok: true });
    const [ins] = registros;
    expect(ins.op).toBe('insert');
    expect(ins.payload).toMatchObject({
      tenant_id: 't-1', sftp_host: 's.ejemplo.com', sftp_puerto: 22, sftp_usuario: 'likida',
      sftp_ruta: '/entrega/corte-pase.xlsx', sftp_huellas: [HUELLA], sftp_activo: true, sftp_intervalo_min: 60,
    });
    expect(cifrarMock).toHaveBeenCalledWith({ clave: 'clave-secreta', llave: undefined, frase: undefined });
  });

  it('con llave privada (sin contraseña) y puerto propio', async () => {
    const PEM = '-----BEGIN OPENSSH PRIVATE KEY-----\nQUJDREVGR0hJSktMTU5PUFFSU1RVVldY\n-----END OPENSSH PRIVATE KEY-----\n';
    const r = await guardarSftpPeajes('t-1', { ...BASE, url: 'sftp://s.ejemplo.com:2222/p.xlsx', clave: undefined, llave: PEM });
    expect(r).toEqual({ ok: true });
    expect((registros[0].payload as Record<string, unknown>).sftp_puerto).toBe(2222);
  });

  it('actualiza (no inserta) cuando ya existe la fila de la flota', async () => {
    existeFila = true;
    await guardarSftpPeajes('t-1', BASE);
    expect(registros[0].op).toBe('update');
  });
});

describe('guardarSftpPeajes — rechazos, sin tocar la base ni el cofre', () => {
  it('dirección que no es sftp:// válida', async () => {
    const r = await guardarSftpPeajes('t-1', { ...BASE, url: 'https://s.ejemplo.com/a.xlsx' });
    expect(r).toMatchObject({ ok: false });
    expect(registros).toHaveLength(0);
  });

  it('usuario con caracteres no permitidos', async () => {
    expect(await guardarSftpPeajes('t-1', { ...BASE, usuario: 'con espacio' })).toMatchObject({ ok: false });
  });

  it('sin contraseña NI llave', async () => {
    expect(await guardarSftpPeajes('t-1', { ...BASE, clave: undefined })).toMatchObject({ ok: false, motivo: expect.stringContaining('llave') });
  });

  it('frase sin llave (la frase solo aplica con llave privada)', async () => {
    expect(await guardarSftpPeajes('t-1', { ...BASE, frase: 'una-frase' })).toMatchObject({ ok: false, motivo: expect.stringContaining('frase') });
  });

  it('sin huella del host (falla cerrada, igual que tabla_propia)', async () => {
    expect(await guardarSftpPeajes('t-1', { ...BASE, huellas: '' })).toMatchObject({ ok: false, motivo: expect.stringContaining('huella') });
  });

  it('huella mal formada (no SHA256)', async () => {
    expect(await guardarSftpPeajes('t-1', { ...BASE, huellas: 'MD5:aabb' })).toMatchObject({ ok: false });
  });

  it('intervalo fuera de 15–1,440 minutos', async () => {
    expect(await guardarSftpPeajes('t-1', { ...BASE, intervaloMin: 10 })).toMatchObject({ ok: false, motivo: expect.stringContaining('intervalo') });
    expect(await guardarSftpPeajes('t-1', { ...BASE, intervaloMin: 2000 })).toMatchObject({ ok: false });
  });

  it('sin el cofre configurado no se guarda nada (no hay credencial sin cifrar como opción)', async () => {
    cofreOk = false;
    const r = await guardarSftpPeajes('t-1', BASE);
    expect(r).toMatchObject({ ok: false, motivo: expect.stringContaining('cofre') });
    expect(registros).toHaveLength(0);
    expect(cifrarMock).not.toHaveBeenCalled();
  });
});

describe('apagarSftpPeajes / borrarCredencialSftp', () => {
  it('apagar solo cambia sftp_activo', async () => {
    await apagarSftpPeajes('t-1');
    expect(registros[0].payload).toMatchObject({ sftp_activo: false });
  });

  it('borrar la credencial también apaga (sin credencial no hay con qué conectar)', async () => {
    await borrarCredencialSftp('t-1');
    expect(registros[0].payload).toMatchObject({ sftp_credencial_cifrada: null, sftp_activo: false });
  });
});
