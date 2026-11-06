import { describe, expect, it, vi } from 'vitest';
import { deflateRawSync } from 'node:zlib';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => { throw new Error('esta prueba no toca la base'); } }));

const { importarLotePanel, importarHistorialPanel, MAX_ARCHIVO_BYTES, MAX_LOTE_BYTES, MAX_ARCHIVOS_LOTE } = await import('./acciones');
const { claveNombre, nombreGrupoDeArchivo } = await import('./lote_nombres');
type Deps = import('./acciones').DepsLote;

const G1 = '11111111-1111-4111-8111-111111111111';
const G2 = '33333333-3333-4333-8333-333333333333';
const C = '22222222-2222-4222-8222-222222222222';
const dueno = { tenantId: 't1', rol: 'flota_admin', usuarioId: 'u1', email: 'a@b.mx' };
const fd = (o: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(o)) f.set(k, v); return f; };
const enc = (t: string) => new TextEncoder().encode(t);

const chat = (cliente: string, extra: string[] = []) => [
  `[12/09/2026, 10:23:45] ${cliente}: ¿Dónde va mi viaje?`,
  '[12/09/2026, 10:25:00] Ana Servicio: Va por Querétaro',
  ...extra,
].join('\n');
const CHAT_A = chat('Cliente Uno');
const CHAT_B = chat('Cliente Dos');

function zipDe(nombre: string, contenido: string): Buffer {
  const datos = Buffer.from(contenido, 'utf8'); const comp = deflateRawSync(datos); const n = Buffer.from(nombre);
  const loc = Buffer.alloc(30); loc.writeUInt32LE(0x04034b50, 0); loc.writeUInt16LE(8, 8); loc.writeUInt32LE(comp.length, 18); loc.writeUInt32LE(datos.length, 22); loc.writeUInt16LE(n.length, 26);
  const cen = Buffer.alloc(46); cen.writeUInt32LE(0x02014b50, 0); cen.writeUInt16LE(8, 10); cen.writeUInt32LE(comp.length, 20); cen.writeUInt32LE(datos.length, 24); cen.writeUInt16LE(n.length, 28);
  const cuerpo = Buffer.concat([loc, n, comp]); const dirc = Buffer.concat([cen, n]);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10); eocd.writeUInt32LE(dirc.length, 12); eocd.writeUInt32LE(cuerpo.length, 16);
  return Buffer.concat([cuerpo, dirc, eocd]);
}

function deps(sobre: Partial<Deps> = {}): Deps & { bitacora: ReturnType<typeof vi.fn>; guardarImportacion: ReturnType<typeof vi.fn>; crearGrupo: ReturnType<typeof vi.fn>; gruposDeFlota: ReturnType<typeof vi.fn> } {
  return {
    crearGrupo: vi.fn(async () => ({ ok: true as const, id: G2 })),
    marcarCritico: vi.fn(async () => true),
    grupoDeFlota: vi.fn(async (_t: string, id: string) => ({ id, nombre: id === G1 ? 'Operación Cliente A' : 'Grupo Dos' })),
    guardarImportacion: vi.fn(async () => ({ ok: true as const, id: 'imp-1' })),
    borrarGrupo: vi.fn(async () => true),
    bitacora: vi.fn(async () => true),
    gruposDeFlota: vi.fn(async () => [{ id: G1, nombre: 'Operación Cliente A', clienteId: C }, { id: G2, nombre: 'Grupo Dos', clienteId: C }]),
    ...sobre,
  } as never;
}
const entrada = (nombre: string, bytes: Uint8Array, grupoNombre = '') => ({ archivo: { nombre, bytes }, grupoNombre });
const EQ = fd({ equipo: 'Ana Servicio' });

describe('importarLotePanel', () => {
  it('zip corrupto con cliente elegido y grupo inexistente: NO crea el grupo ni la bitácora', async () => {
    const d = deps();
    const r = await importarLotePanel(dueno, fd({ equipo: 'Ana Servicio', clienteId: C }), [entrada('roto.zip', new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1, 2, 3, 4, 5, 6]), 'Grupo Nuevo')], d);
    expect(r.ok).toBe(false);
    expect(d.crearGrupo).not.toHaveBeenCalled();
    expect(d.bitacora).not.toHaveBeenCalled();
    expect(d.guardarImportacion).not.toHaveBeenCalled();
  });

  it('grupo creado desde el lote: el resultado avisa que es nuevo', async () => {
    const d = deps();
    const r = await importarLotePanel(dueno, fd({ equipo: 'Ana Servicio', clienteId: C }), [entrada('x.txt', enc(CHAT_A), 'Grupo Nuevo')], d);
    if (!r.ok) throw new Error('x');
    expect(r.archivos[0].grupoNuevo).toBe(true);
    expect(r.archivos[0].detalle).toContain('Grupo nuevo creado');
  });

  it('lote mixto (.txt y .zip): importa cada uno en su grupo y responde por archivo', async () => {
    const d = deps();
    const r = await importarLotePanel(dueno, EQ, [
      entrada('Chat de WhatsApp con Operación Cliente A.txt', enc(CHAT_A)),
      entrada('otro.zip', zipDe('_chat.txt', CHAT_B), 'Grupo Dos'),
    ], d);
    expect(r).toMatchObject({ ok: true, importados: 2, hayImportados: true });
    if (!r.ok) throw new Error('x');
    expect(r.archivos.map((a) => [a.estado, a.grupo])).toEqual([['importado', 'Operación Cliente A'], ['importado', 'Grupo Dos']]);
    expect(d.guardarImportacion).toHaveBeenCalledTimes(2);
    expect(d.guardarImportacion.mock.calls[0][0]).toBe('t1');
    expect(d.guardarImportacion.mock.calls[0][1]).toMatchObject({ grupoId: G1 });
    expect(d.guardarImportacion.mock.calls[1][1]).toMatchObject({ grupoId: G2 });
    expect(r.mensaje).toContain('El sistema solo lee el texto');
  });

  it('un zip corrupto, un archivo vacío y un tipo no válido fallan solos sin tirar a los demás', async () => {
    const d = deps();
    const r = await importarLotePanel(dueno, EQ, [
      entrada('malo.zip', Buffer.from('PK\x03\x04basura'), 'Grupo Dos'),
      entrada('vacio.txt', new Uint8Array(0), 'Grupo Dos'),
      entrada('foto.pdf', enc('hola'), 'Grupo Dos'),
      entrada('bien.txt', enc(CHAT_A), 'Operación Cliente A'),
    ], d);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('x');
    expect(r.archivos.map((a) => a.estado)).toEqual(['error', 'error', 'error', 'importado']);
    expect(r.archivos[0].detalle).toContain('zip');
    expect(r.archivos[1].detalle).toBe('El archivo está vacío.');
    expect(r.archivos[2].detalle).toContain('.txt');
    expect(d.guardarImportacion).toHaveBeenCalledTimes(1);
  });

  it('un duplicado (misma huella) se informa como duplicado y no cuenta como error', async () => {
    const d = deps({ guardarImportacion: vi.fn(async () => ({ ok: false as const, duplicada: true as const })) });
    const r = await importarLotePanel(dueno, EQ, [entrada('a.txt', enc(CHAT_A), 'Grupo Dos')], d);
    expect(r.ok).toBe(true);
    if (!r.ok) throw new Error('x');
    expect(r.archivos[0]).toMatchObject({ estado: 'duplicado', detalle: expect.stringContaining('ya se había subido') });
    expect(r.hayImportados).toBe(false);
    expect(d.bitacora).not.toHaveBeenCalled();
  });

  it('todo con error: ok false con el motivo por archivo', async () => {
    const r = await importarLotePanel(dueno, EQ, [entrada('v.txt', new Uint8Array(0), 'Grupo Dos')], deps());
    expect(r).toMatchObject({ ok: false, error: expect.stringContaining('No se importó ningún archivo'), archivos: [{ estado: 'error' }] });
  });

  it('topes: un archivo de más de 4 MB falla solo; el lote que pesa más de 4 MB juntos se rechaza antes de leer nada; y más de 20 archivos', async () => {
    const d = deps();
    const grande = new Uint8Array(MAX_ARCHIVO_BYTES + 1);
    const solo = await importarLotePanel(dueno, EQ, [entrada('grande.txt', grande, 'Grupo Dos')], d);
    expect(solo.ok).toBe(false);
    const mitad = new Uint8Array(Math.floor(MAX_LOTE_BYTES / 2) + 1);
    const lote = await importarLotePanel(dueno, EQ, [entrada('a.txt', mitad, 'Grupo Dos'), entrada('b.txt', mitad, 'Grupo Dos')], d);
    expect(lote).toMatchObject({ ok: false, error: expect.stringContaining('4 MB') });
    const muchos = Array.from({ length: MAX_ARCHIVOS_LOTE + 1 }, (_, i) => entrada(`c${i}.txt`, enc(CHAT_A), 'Grupo Dos'));
    expect(await importarLotePanel(dueno, EQ, muchos, d)).toMatchObject({ ok: false, error: expect.stringContaining('demasiados') });
    expect(d.guardarImportacion).not.toHaveBeenCalled();
    expect(d.gruposDeFlota).not.toHaveBeenCalled();
  });

  it('sin permiso: solo el dueño; contador, encargado y jefe de tráfico no tocan nada', async () => {
    for (const rol of ['contador', 'encargado', 'jefe_trafico', 'vendedor']) {
      const d = deps();
      const r = await importarLotePanel({ ...dueno, rol }, fd({ equipo: 'Ana Servicio', clienteId: C }), [entrada('a.txt', enc(CHAT_A), 'Grupo Dos')], d);
      expect(r.ok).toBe(false);
      expect(d.gruposDeFlota).not.toHaveBeenCalled();
      expect(d.crearGrupo).not.toHaveBeenCalled();
      expect(d.guardarImportacion).not.toHaveBeenCalled();
    }
  });

  it('tenant ajeno: busca grupos solo con el tenant de la sesión (ignora el del formulario) y un grupo que no es de la flota no se toca', async () => {
    const d = deps({ gruposDeFlota: vi.fn(async () => [{ id: G1, nombre: 'Operación Cliente A', clienteId: C }]) });
    const r = await importarLotePanel(dueno, fd({ equipo: 'Ana Servicio', tenantId: 'ajeno', grupoId: G2 }), [entrada('a.txt', enc(CHAT_A), 'Grupo Dos')], d);
    expect(d.gruposDeFlota).toHaveBeenCalledWith('t1');
    expect(r.ok).toBe(false);
    if (r.ok || !r.archivos) throw new Error('x');
    expect(r.archivos[0].detalle).toContain('No hay un grupo con ese nombre');
    expect(d.guardarImportacion).not.toHaveBeenCalled();
    expect(d.crearGrupo).not.toHaveBeenCalled();
  });

  it('un grupo inexistente se crea (no crítico, con bitácora) solo si se eligió cliente; el cliente se valida', async () => {
    const d = deps({ gruposDeFlota: vi.fn(async () => []) });
    const r = await importarLotePanel(dueno, fd({ equipo: 'Ana Servicio', clienteId: C }), [entrada('Chat de WhatsApp con Grupo Nuevo.txt', enc(CHAT_A))], d);
    expect(r.ok).toBe(true);
    expect(d.crearGrupo).toHaveBeenCalledWith('t1', { clienteId: C, nombre: 'Grupo Nuevo', critico: false });
    expect(d.bitacora).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 't1', accion: 'vigia.grupo_creado' }));
    expect(await importarLotePanel(dueno, fd({ equipo: 'Ana Servicio', clienteId: 'no' }), [entrada('a.txt', enc(CHAT_A))], d)).toMatchObject({ ok: false, error: 'Cliente no válido.' });
  });

  it('nombres con acentos: el equipo y el grupo se reconocen sin importar acentos ni mayúsculas', async () => {
    const d = deps();
    const txt = ['[12/09/2026, 10:23:45] Cliente Uno: ¿Cuándo llega?', '[12/09/2026, 10:25:00] Operador Tráfico Ñandú: Mañana a las 9'].join('\n');
    const r = await importarLotePanel(dueno, fd({ equipo: 'Operador Tráfico Ñandú' }), [entrada('x.txt', enc(txt), '  OPERACION   cliente a ')], d);
    expect(r).toMatchObject({ ok: true, importados: 1 });
    expect(d.guardarImportacion.mock.calls[0][1]).toMatchObject({ grupoId: G1 });
    expect(claveNombre('Operación Ñandú')).toBe('operacion nandu');
    expect(nombreGrupoDeArchivo('Chat de WhatsApp con Operación Ñandú.txt')).toBe('Operación Ñandú');
    expect(nombreGrupoDeArchivo('WhatsApp Chat - Grupo Dos.zip')).toBe('Grupo Dos');
  });

  it('dos grupos con el mismo nombre: no adivina, lo dice', async () => {
    const d = deps({ gruposDeFlota: vi.fn(async () => [{ id: G1, nombre: 'Grupo Dos', clienteId: C }, { id: G2, nombre: 'grupo dos', clienteId: C }]) });
    const r = await importarLotePanel(dueno, EQ, [entrada('a.txt', enc(CHAT_A), 'Grupo Dos')], d);
    expect(r.ok).toBe(false);
    if (r.ok || !r.archivos) throw new Error('x');
    expect(r.archivos[0].detalle).toContain('más de un grupo');
  });

  it('adjuntos omitidos: se cuentan por archivo, salen en el resultado y en la bitácora (solo el número), sin guardar nada nuevo', async () => {
    const d = deps();
    const conAdjuntos = chat('Cliente Uno', ['[12/09/2026, 10:30:00] Cliente Uno: <adjunto: 0001-PHOTO.jpg>', '[12/09/2026, 10:31:00] Cliente Uno: audio omitido']);
    const r = await importarLotePanel(dueno, EQ, [entrada('a.txt', enc(conAdjuntos), 'Operación Cliente A'), entrada('b.txt', enc(CHAT_B), 'Grupo Dos')], d);
    if (!r.ok) throw new Error('x');
    expect(r.archivos[0].adjuntosSinTexto).toBe(2);
    expect(r.archivos[0].detalle).toContain('2 archivos adjuntos sin texto que el sistema no revisa');
    expect(r.archivos[1].adjuntosSinTexto).toBe(0);
    expect(r.archivos[1].detalle).not.toContain('adjuntos sin texto');
    expect(d.bitacora).toHaveBeenCalledWith(expect.objectContaining({ detalle: expect.objectContaining({ adjuntosSinTexto: 2 }) }));
    // Lo que se guarda son solo los mensajes con texto: ni los adjuntos ni el conteo viajan al repo.
    const guardado = d.guardarImportacion.mock.calls[0][1];
    expect(guardado.mensajes).toHaveLength(2);
    expect(Object.keys(guardado).sort()).toEqual(['grupoId', 'mensajes', 'sha256', 'usuarioId']);
  });

  it('equipo vacío y lote sin archivos se rechazan', async () => {
    expect(await importarLotePanel(dueno, fd({ equipo: '' }), [entrada('a.txt', enc(CHAT_A))], deps())).toMatchObject({ ok: false });
    expect(await importarLotePanel(dueno, EQ, [], deps())).toMatchObject({ ok: false });
  });
});

describe('importarHistorialPanel (un archivo) con adjuntos', () => {
  it('suma el conteo de adjuntos sin texto al mensaje', async () => {
    const d = deps();
    const txt = chat('Cliente Uno', ['[12/09/2026, 10:30:00] Cliente Uno: imagen omitida']);
    const r = await importarHistorialPanel(dueno, fd({ grupoId: G1, equipo: 'Ana Servicio' }), { nombre: 'c.txt', bytes: enc(txt) }, d);
    expect(r.ok && r.mensaje).toContain('1 archivo adjunto sin texto que el sistema no revisa');
  });
});
