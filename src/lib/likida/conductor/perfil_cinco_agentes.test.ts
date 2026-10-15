/* eslint-disable security/detect-non-literal-fs-filename -- pruebas que leen el árbol de FUENTE del propio repo; ninguna ruta viene de entrada de usuario. */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  RUTAS_PERFIL_CINCO_AGENTES, RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, CRONS_PERFIL_CINCO_AGENTES, API_PERFIL_CINCO_AGENTES,
  rutaPermitidaEnPerfil, apiPermitidaEnPerfil,
} from '@/lib/auth/visibilidad';

// ═══════════════════════════════════════════════════════════════════════════
// T-A5-33 · BAJO EL PERFIL `cinco_agentes`, EL AGENTE 5 (CONDUCTOR) SIGUE FUNCIONANDO
// Y LO STAND-BY SIGUE EXISTIENDO.
//
// El perfil cierra todo lo que no está en su lista. Estas pruebas afirman el otro lado: que el
// camino del Conductor (páginas, API, crons y la entrada del chofer por WhatsApp) NO quedó cerrado
// por accidente, y que lo que sí se oculta (asistencia, jornada, convenios) sigue en el código.
// Si B1 cierra el camino del chofer, aquí se pone rojo y se reporta como BLOQUEO a B1 (no se arregla en A5).
// Los guardas son de B1 (`visibilidad.ts`, `perfil_tenant.ts`): esta prueba solo los LEE.
// ═══════════════════════════════════════════════════════════════════════════

const perfiles = new Map<string, string>();
vi.mock('@/lib/supabase/admin', () => ({
  supabaseAdmin: () => ({
    from: (tabla: string) => {
      const b: Record<string, unknown> = {};
      let id = '';
      b.select = () => b;
      b.eq = (c: string, v: string) => { if (c === 'tenant_id') id = v; return b; };
      b.maybeSingle = async () => {
        if (tabla === 'tenant_perfil') return { data: perfiles.has(id) ? { perfil: perfiles.get(id) } : null, error: null };
        return { data: null, error: null };
      };
      return b;
    },
  }),
}));
vi.mock('@/lib/likida/presupuesto', () => ({ acotada: (p: unknown) => p }));
vi.mock('@/lib/logger', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock('next/navigation', () => ({ redirect: (a: string) => { throw new Error(`NEXT_REDIRECT:${a}`); } }));

const { cronAplicaAPerfil, nombreDeCron, reiniciarCachePerfil } = await import('@/lib/auth/perfil_tenant');
const { pipelineTenantApagado } = await import('@/lib/likida/interruptor_tenant');

const RAIZ = process.cwd();
const leer = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

const PERFIL = 'cinco_agentes';

describe('páginas del Conductor bajo el perfil', () => {
  const PAGINAS = [
    '/dashboard/agentes/conductores',
    '/dashboard/agentes/conductores/sitios',
    '/dashboard/agentes/conductores/estadias',
    '/dashboard/agentes/conductores/configuracion',
    '/dashboard/viajes-en-vivo',
    '/dashboard/mapa',
  ];

  it.each(PAGINAS)('%s está permitida y es del módulo conductor', (ruta) => {
    expect(rutaPermitidaEnPerfil(PERFIL, ruta)).toBe(true);
    expect(RUTAS_PERFIL_CINCO_AGENTES[ruta]).toBe('conductor');
  });

  it('la ruta con barra final o query sigue permitida (misma llave)', () => {
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/conductores/')).toBe(true);
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/conductores/estadias?viaje=1')).toBe(true);
  });

  it('cada página del Conductor existe de verdad en el árbol (no es una llave huérfana)', () => {
    for (const ruta of PAGINAS) expect(existsSync(join(RAIZ, 'src/app', ruta.slice(1), 'page.tsx')), ruta).toBe(true);
  });

  it('una subruta del Conductor que nadie clasificó se niega (falla cerrado), no se cuela por prefijo', () => {
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/conductores/nueva-pantalla')).toBe(false);
  });
});

describe('API del Conductor bajo el perfil', () => {
  it('los recursos del Conductor en /api/v1 están permitidos', () => {
    for (const recurso of ['hitos', 'estadias', 'sitios', 'conductor', 'evidencias']) {
      expect(API_PERFIL_CINCO_AGENTES.v1, recurso).toContain(recurso);
      expect(apiPermitidaEnPerfil(PERFIL, `/api/v1/${recurso}`), recurso).toBe(true);
    }
    expect(apiPermitidaEnPerfil(PERFIL, '/api/v1/conductor/config')).toBe(true);
    expect(apiPermitidaEnPerfil(PERFIL, '/api/v1/hitos/eventos')).toBe(true);
  });

  it('cada recurso /v1 del Conductor que el perfil nombra tiene su carpeta en el código', () => {
    for (const recurso of ['hitos', 'estadias', 'sitios', 'conductor', 'evidencias']) {
      expect(existsSync(join(RAIZ, 'src/app/api/v1', recurso)), recurso).toBe(true);
    }
  });

  it('lo que no es de los cinco agentes en /v1 sigue negado (el perfil no se abrió de más)', () => {
    expect(apiPermitidaEnPerfil(PERFIL, '/api/v1/clientes')).toBe(false);
  });
});

describe('crons del Conductor bajo el perfil', () => {
  it.each(['conductor-hitos', 'escalar', 'gps'])('el cron %s sigue corriendo para flotas con perfil', (cron) => {
    expect(CRONS_PERFIL_CINCO_AGENTES).toContain(cron);
    expect(cronAplicaAPerfil(cron)).toBe(true);
    expect(existsSync(join(RAIZ, 'src/app/api/cron', cron, 'route.ts')), cron).toBe(true);
  });

  it('el nombre del cron se saca de la ruta tal como llega', () => {
    expect(nombreDeCron('/api/cron/conductor-hitos')).toBe('conductor-hitos');
    expect(nombreDeCron('/api/cron/gps?x=1')).toBe('gps');
  });

  it('el cron `escalar` es mixto: las secciones de stand-by se saltan flotas con perfil', () => {
    const fuente = leer('src/app/api/cron/escalar/route.ts');
    expect(fuente).toContain('tenantsConPerfil');
  });
});

describe('entrada del chofer por WhatsApp bajo el perfil', () => {
  beforeEach(() => { reiniciarCachePerfil(); perfiles.clear(); perfiles.set('t-con', PERFIL); });

  it('la recepción por WhatsApp (botones de hito, pin de ubicación) NO se apaga con el perfil', async () => {
    expect(await pipelineTenantApagado('t-con', 'whatsapp')).toBe(false);
  });

  it('lo que SÍ se apaga es la lectura de comprobantes y el cierre por WhatsApp (stand-by de A1)', async () => {
    expect(await pipelineTenantApagado('t-con', 'ocr')).toBe(true);
    expect(await pipelineTenantApagado('t-con', 'cuadre')).toBe(true);
  });

  it('sin perfil, ningún pipeline se apaga de más', async () => {
    for (const p of ['whatsapp', 'ocr', 'cuadre'] as const) expect(await pipelineTenantApagado('t-sin', p), p).toBe(false);
  });

  it('el webhook de WhatsApp no consulta el perfil: el camino de entrada del chofer no se cierra en la puerta', () => {
    expect(leer('src/app/api/webhook/whatsapp/route.ts')).not.toMatch(/perfil/i);
  });

  it('en el procesador, las compuertas de perfil solo cierran comprobantes y cierre, y el Conductor sigue cableado', () => {
    const fuente = leer('src/lib/likida/processor.ts');
    // Las compuertas de perfil del procesador solo preguntan por `ocr` y `cuadre`; ninguna por `whatsapp`.
    const compuertas = [...fuente.matchAll(/pipelineTenantApagado\([^,]+,\s*'(\w+)'\)/g)].map((m) => m[1]);
    expect(compuertas.length).toBeGreaterThan(0);
    for (const p of compuertas.filter((c) => c !== 'whatsapp')) expect(['ocr', 'cuadre']).toContain(p);
    // El Conductor sigue cableado en el procesador (atiende al chofer y registra la evidencia de hitos).
    expect(fuente).toContain('atenderConductor(');
    expect(fuente).toContain('registrarEvidenciaDelChofer');
  });
});

describe('acciones de servidor del piloto de voluntarios', () => {
  it('las acciones de voluntarios viven en una pantalla PERMITIDA por el perfil', () => {
    const pagina = 'src/app/dashboard/agentes/conductores/configuracion/page.tsx';
    expect(leer(pagina)).toContain('acciones_voluntarios');
    expect(rutaPermitidaEnPerfil(PERFIL, '/dashboard/agentes/conductores/configuracion')).toBe(true);
  });

  it('esa pantalla está clasificada como permitida en el escaneo de acciones de servidor', () => {
    expect(leer('src/app/dashboard/perfil_acciones.test.ts')).toContain("'agentes/conductores/configuracion/page.tsx': 'permitido'");
  });
});

describe('lo stand-by sigue existiendo (se oculta, no se borra)', () => {
  const PANTALLAS_STAND_BY = ['/dashboard/asistencia', '/dashboard/jornada', '/dashboard/convenios'];

  it.each(PANTALLAS_STAND_BY)('%s está negada bajo el perfil y su página sigue en el árbol', (ruta) => {
    expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES).toContain(ruta);
    expect(rutaPermitidaEnPerfil(PERFIL, ruta)).toBe(false);
    expect(existsSync(join(RAIZ, 'src/app', ruta.slice(1), 'page.tsx')), ruta).toBe(true);
  });

  it('los módulos asistencia_*, jornada/* y convenios/* siguen exportando', () => {
    const modulos = [
      'src/lib/likida/asistencia_wa.ts', 'src/lib/likida/asistencia_coordinacion.ts', 'src/lib/likida/asistencia_escalamiento.ts',
      'src/lib/likida/asistencia_proveedor.ts', 'src/lib/likida/asistencia_camara.ts',
      'src/lib/likida/jornada/alerta_tope.ts', 'src/lib/likida/convenios/acciones.ts', 'src/lib/likida/convenios/envio.ts',
      'src/lib/likida/convenios/importador.ts',
    ];
    for (const m of modulos) {
      expect(existsSync(join(RAIZ, m)), m).toBe(true);
      expect(leer(m), m).toMatch(/^export\s/m);
    }
  });

  it.each(['asistencia', 'jornada', 'jornada-alertas'])('el cron %s existe y SALTA a las flotas con perfil (no corre para ellas)', (cron) => {
    expect(existsSync(join(RAIZ, 'src/app/api/cron', cron, 'route.ts')), cron).toBe(true);
    expect(CRONS_PERFIL_CINCO_AGENTES).not.toContain(cron);
    expect(cronAplicaAPerfil(cron)).toBe(false);
  });

  it('los crons de asistencia y jornada leen la lista de flotas con perfil para excluirlas', () => {
    for (const cron of ['asistencia', 'jornada']) expect(leer(`src/app/api/cron/${cron}/route.ts`), cron).toContain('tenantsConPerfilASaltar');
  });

  it('todo lo stand-by del Conductor sigue clasificado: ninguna ruta del Conductor quedó a la vez permitida y en stand-by', () => {
    const delConductor = Object.entries(RUTAS_PERFIL_CINCO_AGENTES).filter(([, m]) => m === 'conductor').map(([r]) => r);
    expect(delConductor.length).toBeGreaterThan(0);
    for (const r of delConductor) expect(RUTAS_STAND_BY_PERFIL_CINCO_AGENTES, r).not.toContain(r);
  });
});
