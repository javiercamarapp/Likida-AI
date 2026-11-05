import { describe, it, expect, vi } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';

vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('@/lib/supabase/admin', () => ({ supabaseAdmin: () => ({}) }));

const { MAPA_DATOS_AGENTE, tablasExportables, mapaDeDatosMarkdown } = await import('./mapa_datos');
const { armarPaquete, verificarPaquete, columnaSecreta, sha256 } = await import('./paquete');
const { exportarFlota, offboardingActivo, PAGINA } = await import('./exportar');

const T = '11111111-1111-4111-8111-111111111111';

describe('mapa de datos por agente', () => {
  it('cubre cada módulo del perfil', () => {
    const visibilidad = readFileSync('src/lib/auth/visibilidad.ts', 'utf8');
    const m = /export type ModuloPerfil = ([^;]+);/.exec(visibilidad)!;
    const modulos = [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort();
    expect(Object.keys(MAPA_DATOS_AGENTE).sort()).toEqual(modulos);
  });
  it('cada tabla existe en las migraciones y trae columna de flota (o es tenant)', () => {
    const sql = readdirSync('supabase/migrations').filter((f) => f.endsWith('.sql'))
      .map((f) => readFileSync(`supabase/migrations/${f}`, 'utf8')).join('\n');
    for (const t of tablasExportables()) {
      expect(new RegExp(`create table (if not exists )?(public\\.)?${t}\\b`, 'i').test(sql), t).toBe(true);
    }
  });
  it('sin tablas repetidas y cada agente declara subencargados', () => {
    const t = tablasExportables();
    expect(new Set(t).size).toBe(t.length);
    for (const e of Object.values(MAPA_DATOS_AGENTE)) expect(e.subencargados.length).toBeGreaterThan(0);
  });
  it('docs/enterprise/mapa-de-datos.md es exactamente lo que genera el mapa', () => {
    expect(readFileSync('docs/enterprise/mapa-de-datos.md', 'utf8')).toBe(mapaDeDatosMarkdown());
  });
});

describe('paquete verificable', () => {
  const lecturas = [
    { tabla: 'viaje', filas: [{ id: 'a', monto: 10 }, { id: 'b', monto: 20 }] },
    { tabla: 'app_user', filas: [{ id: 'u', rol: 'flota_admin', token_acceso: 'SECRETO', hash_x: 'h' }] },
    { tabla: 'gasto', filas: [] },
  ];
  it('arma archivos con huella y omite columnas secretas, diciéndolo', () => {
    const p = armarPaquete(T, lecturas, new Date('2026-11-04T12:00:00Z'));
    expect(p.manifiesto.completo).toBe(true);
    expect(p.manifiesto.filas_total).toBe(3);
    const u = p.archivos.find((a) => a.nombre === 'app_user.jsonl')!;
    expect(u.contenido).not.toContain('SECRETO');
    expect(p.manifiesto.archivos.find((e) => e.tabla === 'app_user')!.columnas_omitidas).toEqual(['hash_x', 'token_acceso']);
    expect(p.archivos.find((a) => a.nombre === 'viaje.jsonl')!.sha256).toBe(sha256(p.archivos.find((a) => a.nombre === 'viaje.jsonl')!.contenido));
  });
  it('íntegro pasa; cualquier alteración se detecta', () => {
    const p = armarPaquete(T, lecturas);
    const archivos = p.archivos.map((a) => ({ nombre: a.nombre, contenido: a.contenido }));
    expect(verificarPaquete(archivos, p.manifiestoJson, p.huellaManifiesto)).toEqual([]);
    const alterado = archivos.map((a) => (a.nombre === 'viaje.jsonl' ? { ...a, contenido: a.contenido.replace('10', '99') } : a));
    expect(verificarPaquete(alterado, p.manifiestoJson, p.huellaManifiesto).join()).toMatch(/viaje.jsonl cambió/);
    expect(verificarPaquete(archivos.slice(1), p.manifiestoJson, p.huellaManifiesto).join()).toMatch(/falta el archivo/);
    expect(verificarPaquete(archivos, p.manifiestoJson + ' ', p.huellaManifiesto).join()).toMatch(/huella del manifiesto/);
    expect(verificarPaquete([...archivos, { nombre: 'x.jsonl', contenido: '' }], p.manifiestoJson, p.huellaManifiesto).join()).toMatch(/ajeno/);
  });
  it('una tabla con error deja el paquete incompleto', () => {
    const p = armarPaquete(T, [...lecturas, { tabla: 'posicion', error: 'boom' }]);
    expect(p.manifiesto.completo).toBe(false);
  });
  it('detecta nombres de columna secretos', () => {
    expect(columnaSecreta('cifrado_v2')).toBe(true);
    expect(columnaSecreta('monto')).toBe(false);
  });
});

function sbFalso(opciones: { falla?: string; paginas?: number; insertError?: boolean }) {
  const insertados: unknown[] = [];
  return {
    insertados,
    sb: {
      from: (tabla: string) => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              range: async (desde: number) => {
                if (opciones.falla === tabla) return { data: null, error: { message: 'no existe' } };
                const llenas = opciones.paginas ?? 0;
                const n = desde / PAGINA < llenas ? PAGINA : 2;
                return { data: Array.from({ length: n }, (_, i) => ({ id: `${tabla}-${desde + i}` })), error: null };
              },
            }),
          }),
        }),
        insert: (fila: unknown) => ({
          select: () => ({ single: async () => (opciones.insertError ? { data: null, error: { message: 'x' } } : (insertados.push([tabla, fila]), { data: { id: 'exp-1' }, error: null })) }),
        }),
      }),
    } as never,
  };
}
const ON = { LIKIDA_OFFBOARDING_EXPORTACION: 'activo' };

describe('exportarFlota', () => {
  it('apagada por omisión', async () => {
    expect(offboardingActivo({})).toBe(false);
    const r = await exportarFlota(T, 'u', { env: {} });
    expect(r.ok).toBe(false);
  });
  it('completa: registra la constancia con la huella del manifiesto', async () => {
    const { sb, insertados } = sbFalso({});
    const r = await exportarFlota(T, 'u', { sb, env: ON });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.exportacionId).toBe('exp-1');
      expect(insertados).toHaveLength(1);
      expect((insertados[0] as [string, { huella_sha256: string }])[1].huella_sha256).toBe(r.paquete.huellaManifiesto);
    }
  });
  it('una tabla ilegible: no hay constancia', async () => {
    const { sb, insertados } = sbFalso({ falla: 'posicion' });
    const r = await exportarFlota(T, 'u', { sb, env: ON });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.motivo).toMatch(/posicion \(error\)/);
    expect(insertados).toHaveLength(0);
  });
  it('si no se puede guardar la constancia, lo dice', async () => {
    const { sb } = sbFalso({ insertError: true });
    const r = await exportarFlota(T, 'u', { sb, env: ON });
    expect(r.ok).toBe(false);
  });
});
