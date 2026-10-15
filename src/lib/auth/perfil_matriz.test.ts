/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta ni patrón viene de entrada de usuario. */
import { describe, it, expect } from 'vitest';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { enumerar, clasificar, construirMatriz, aMarkdown, NO_CLASIFICADO } from '../../../scripts/perfil/matriz-superficies.mjs';

// ═══════════════════════════════════════════════════════════════════════════
// LA MATRIZ DE SUPERFICIES DEL PERFIL `cinco_agentes` (T-PER-01).
//
// `scripts/perfil/matriz-superficies.mjs` enumera desde el sistema de archivos y
// la config —páginas, server actions, APIs /v1·/export·/dashboard, MCP, webhooks,
// crons, herramientas del chat y del MCP— y las cruza con la lista cerrada del
// perfil. Esta prueba exige que NADA salga `NO CLASIFICADO`: una superficie nueva
// que nadie clasifique pone la prueba en rojo (en runtime ya se niega: falla
// cerrado; el inventario existe para que alguien tenga que decidirlo).
//
// Las pruebas por superficie (fugas reales) son T-PER-02…06; aquí vive el mapa.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = process.cwd();
type Fila = { superficie: string; id: string; veredicto: string; nota: string };

function archivos(dir: string, filtro: (n: string) => boolean, salida: string[] = []): string[] {
  for (const n of readdirSync(join(RAIZ, dir))) {
    const rel = join(dir, n);
    if (statSync(join(RAIZ, rel)).isDirectory()) archivos(rel, filtro, salida);
    else if (filtro(n)) salida.push(rel);
  }
  return salida;
}

const matriz = construirMatriz(RAIZ) as Fila[];
const deSuperficie = (s: string) => matriz.filter((f) => f.superficie === s);

describe('matriz: nada sin clasificar', () => {
  it('ninguna superficie del repo sale NO CLASIFICADO', () => {
    expect(matriz.filter((f) => f.veredicto === NO_CLASIFICADO).map((f) => `${f.superficie} ${f.id}: ${f.nota}`)).toEqual([]);
  });

  it('todo veredicto es permitido o negado', () => {
    expect(new Set(matriz.map((f) => f.veredicto))).toEqual(new Set(['permitido', 'negado']));
  });

  it('el markdown no contiene la marca NO CLASIFICADO (el criterio del comando es grep -c = 0)', () => {
    expect(aMarkdown(matriz)).not.toContain(NO_CLASIFICADO);
  });
});

describe('matriz: la enumeración es completa (cuenta independiente, desde el disco)', () => {
  it.each([
    ['página', 'las 63 page.tsx de /dashboard', () => archivos('src/app/dashboard', (n) => n === 'page.tsx').length],
    ["'use server'", 'cada archivo fuente con la directiva', () =>
      archivos('src', (n) => /\.(ts|tsx)$/.test(n) && !/\.test\./.test(n))
        .filter((f) => /^\s*['"]use server['"]/m.test(readFileSync(join(RAIZ, f), 'utf8'))).length],
    ['API /v1', 'cada recurso de /v1', () => readdirSync(join(RAIZ, 'src/app/api/v1')).filter((n) => statSync(join(RAIZ, 'src/app/api/v1', n)).isDirectory()).length],
    ['API /export', 'cada export', () => readdirSync(join(RAIZ, 'src/app/api/export')).filter((n) => statSync(join(RAIZ, 'src/app/api/export', n)).isDirectory()).length],
  ])('%s: %s', (superficie, _que, contar) => {
    const esperadas = (contar as () => number)();
    expect(esperadas).toBeGreaterThan(0);
    expect(deSuperficie(superficie as string).length).toBe(esperadas);
  });

  it('crons: el conteo coincide con vercel.json y con las carpetas del disco', () => {
    const vercel = (JSON.parse(readFileSync(join(RAIZ, 'vercel.json'), 'utf8')).crons as Array<{ path: string }>).map((c) => c.path.replace('/api/cron/', ''));
    const disco = readdirSync(join(RAIZ, 'src/app/api/cron')).filter((n) => statSync(join(RAIZ, 'src/app/api/cron', n)).isDirectory());
    const filas = deSuperficie('cron');
    expect(filas.length).toBe(vercel.length);
    expect(filas.map((f) => f.id.replace('/api/cron/', '')).sort()).toEqual([...vercel].sort());
    expect([...disco].sort()).toEqual([...vercel].sort());
  });

  it('cada superficie declarada tiene al menos una fila (un enumerador roto no pasa en silencio)', () => {
    for (const s of ['página', "'use server'", 'API /v1', 'API /export', 'API /dashboard', 'MCP endpoint', 'webhook', 'cron', 'herramienta MCP', 'herramienta del chat', 'analista del chat']) {
      expect(deSuperficie(s).length, s).toBeGreaterThan(0);
    }
  });
});

describe('matriz: lo permitido es exactamente la lista del perfil', () => {
  it('ningún cron de stand-by figura permitido y ninguno permitido figura negado', () => {
    const permitidos = deSuperficie('cron').filter((f) => f.veredicto === 'permitido').map((f) => f.id.replace('/api/cron/', ''));
    for (const c of ['facturar', 'descarga-sat', 'jornada', 'jornada-alertas', 'asistencia', 'buzon-entrega']) expect(permitidos, c).not.toContain(c);
    for (const c of ['gps', 'peajes', 'vigia', 'conductor-hitos', 'carta-porte-docs', 'liquidaciones-externas']) expect(permitidos, c).toContain(c);
  });

  it('el MCP y el chat figuran negados por completo (todo o nada bajo el perfil)', () => {
    for (const s of ['herramienta MCP', 'herramienta del chat', 'analista del chat']) {
      expect(deSuperficie(s).filter((f) => f.veredicto !== 'negado'), s).toEqual([]);
    }
  });

  it('una página de dinero o fiscal figura negada', () => {
    const neg = deSuperficie('página').filter((f) => f.veredicto === 'negado').map((f) => f.id);
    for (const r of ['/dashboard/facturacion', '/dashboard/timbrado/[viajeId]', '/dashboard/suscripcion', '/dashboard/llaves-api']) expect(neg, r).toContain(r);
  });
});

describe('test del test: una superficie nueva sin clasificar SÍ se detecta', () => {
  const base = enumerar(RAIZ) as Array<Record<string, unknown>>;
  const sinClasificar = (extra: Array<Record<string, unknown>>) =>
    (clasificar([...base, ...extra], RAIZ) as Fila[]).filter((f) => f.veredicto === NO_CLASIFICADO).map((f) => f.id);

  it('control: sin añadir nada, no hay ninguna', () => {
    expect(sinClasificar([])).toEqual([]);
  });
  it('una página ficticia fija', () => {
    expect(sinClasificar([{ superficie: 'página', id: '/dashboard/ficticia', ruta: '/dashboard/ficticia' }])).toEqual(['/dashboard/ficticia']);
  });
  it('una página ficticia dinámica sin RUTA_PADRE ni padre conocido', () => {
    expect(sinClasificar([{ superficie: 'página', id: '/dashboard/ficticia/[x]', ruta: '/dashboard/ficticia/[x]' }])).toEqual(['/dashboard/ficticia/[x]']);
  });
  it('un cron ficticio en disco sin filtro de perfil', () => {
    expect(sinClasificar([{ superficie: 'cron', id: '/api/cron/ficticio', nombre: 'ficticio', enDisco: true, enVercel: true }])).toEqual(['/api/cron/ficticio']);
  });
  it('un cron en vercel.json sin carpeta', () => {
    expect(sinClasificar([{ superficie: 'cron', id: '/api/cron/fantasma', nombre: 'fantasma', enDisco: false, enVercel: true }])).toEqual(['/api/cron/fantasma']);
  });
  it('un recurso /v1, un export y un endpoint de /dashboard nuevos', () => {
    expect(sinClasificar([
      { superficie: 'API /v1', id: '/api/v1/ficticio', raiz: 'v1', nombre: 'ficticio' },
      { superficie: 'API /export', id: '/api/export/ficticio', raiz: 'export', nombre: 'ficticio' },
      { superficie: 'API /dashboard', id: '/api/dashboard/ficticio', raiz: 'dashboard', nombre: 'ficticio' },
    ])).toEqual(['/api/v1/ficticio', '/api/export/ficticio', '/api/dashboard/ficticio']);
  });
  it('un archivo con acciones fuera de las áreas conocidas y una ruta MCP sin puerta', () => {
    expect(sinClasificar([
      { superficie: "'use server'", id: 'src/app/ficticio/page.tsx', archivo: 'src/app/ficticio/page.tsx' },
      { superficie: 'MCP endpoint', id: 'src/app/api/mcp/ficticio/route.ts', archivo: 'src/app/api/mcp/ficticio/route.ts' },
      { superficie: 'webhook', id: 'src/app/api/webhook/ficticio/route.ts', archivo: 'src/app/api/webhook/ficticio/route.ts' },
    ])).toEqual(['src/app/ficticio/page.tsx', 'src/app/api/mcp/ficticio/route.ts', 'src/app/api/webhook/ficticio/route.ts']);
  });
  it('una superficie desconocida', () => {
    expect(sinClasificar([{ superficie: 'otra-cosa', id: 'x' }])).toEqual(['x']);
  });
});

describe('páginas sin llave propia que gatean con una ruta siempre permitida (T-PER-11)', () => {
  const RUTA = '/dashboard/proximamente/[modulo]';
  const arbol = (fuente: string) => {
    const raiz = mkdtempSync(join(tmpdir(), 'matriz-'));
    mkdirSync(join(raiz, 'src/app', RUTA), { recursive: true });
    writeFileSync(join(raiz, 'src/app', RUTA, 'page.tsx'), fuente);
    return raiz;
  };
  const veredicto = (raiz: string) =>
    (clasificar([{ superficie: 'página', id: RUTA, ruta: RUTA }], raiz) as Fila[])[0];

  it('con la compuerta de /dashboard en su fuente: permitida', () => {
    const v = veredicto(arbol("await resolverTenantEfectivo('/dashboard', sp);"));
    expect(v.veredicto).toBe('permitido');
    expect(v.nota).toContain('gatea con /dashboard');
  });
  it('sin esa compuerta en su fuente la declaración no basta: NO CLASIFICADO', () => {
    expect(veredicto(arbol("await resolverTenantEfectivo('/dashboard/vigia', sp);")).veredicto).toBe(NO_CLASIFICADO);
    expect(veredicto(arbol('export default function P() { return null; }')).veredicto).toBe(NO_CLASIFICADO);
  });
  it('otra página dinámica sin llave sigue sin clasificar aunque use la misma compuerta', () => {
    const raiz = arbol("await resolverTenantEfectivo('/dashboard', sp);");
    const otra = '/dashboard/otra/[x]';
    mkdirSync(join(raiz, 'src/app', otra), { recursive: true });
    writeFileSync(join(raiz, 'src/app', otra, 'page.tsx'), "await resolverTenantEfectivo('/dashboard', sp);");
    expect((clasificar([{ superficie: 'página', id: otra, ruta: otra }], raiz) as Fila[])[0].veredicto).toBe(NO_CLASIFICADO);
  });
});
