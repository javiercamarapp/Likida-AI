import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// ═══════════════════════════════════════════════════════════════════════════
// /mis-viajes ESTABA CAÍDA EN PRODUCCIÓN PARA TODOS LOS CHOFERES.
//
// La 0028 le puso a `liquidacion` una SEGUNDA llave foránea hacia `viaje` —la
// compuesta `(viaje_id, tenant_id)`, para que no se pueda colgar una
// liquidación de un viaje de otra flota—, así que hay DOS caminos entre las
// dos tablas y PostgREST se niega a elegir. Un embed `liquidacion(...)` a
// secas devuelve PGRST201, esta página hace `throw` con el error y no queda
// una lista incompleta: queda una pantalla de error.
//
// Comprobado contra la base real (proyecto gngoqsvrxdguxvsizpbw) el
// 4-ago-2026 — `pg_constraint` lista `liquidacion_viaje_id_fkey` Y
// `liquidacion_viaje_tenant_fkey`, y el PostgREST del proyecto contesta:
//
//   {"code":"PGRST201","message":"Could not embed because more than one
//    relationship was found for 'viaje' and 'liquidacion'",
//    "hint":"Try changing 'liquidacion' to one of the following:
//    'liquidacion!liquidacion_viaje_id_fkey', ..."}
//
// La prueba es de FUENTE y no de base a propósito: el fallo no está en un
// valor que se pueda calcular, está en un string de consulta que solo la base
// juzga, y el CI no la tiene. Lo que se puede fijar aquí —y es lo que se
// perdió— es que nadie vuelva a escribir el embed sin nombrar el FK.
// ═══════════════════════════════════════════════════════════════════════════

const RAIZ = fileURLToPath(new URL('../../', import.meta.url));

function fuentes(): string[] {
  return execSync(`find ${RAIZ} -name '*.ts' -o -name '*.tsx'`, { encoding: 'utf8' })
    .split('\n')
    .filter((f) => f && !f.endsWith('.test.ts') && !f.endsWith('.test.tsx'));
}

/**
 * Un embed de `liquidacion` SIN `!` inmediatamente después del nombre.
 *
 * `liquidacion!liquidacion_viaje_id_fkey(` pasa; `liquidacion(` no. Se busca
 * en todo `src/` y no solo en esta página porque el error no es de esta
 * página: es de cualquiera que embeba esas dos tablas, y ya pasó dos veces
 * (aquí y —bien resuelto— en `lib/cuadra/chofer.ts`).
 */
const EMBED_SIN_FK = /\bliquidacion\s*\(/;

describe('el embed de liquidacion nombra su llave foránea — si no, PGRST201', () => {
  it('ningún archivo de src/ embebe `liquidacion(` sin nombrar el FK', () => {
    const culpables = fuentes().filter((f) => {
      const txt = readFileSync(f, 'utf8');
      // Solo dentro de un `.select(...)`: `liquidacion(` en una firma de
      // función o en un comentario no es un embed de PostgREST.
      const selects = txt.match(/\.select\(\s*(`[^`]*`|'[^']*'|"[^"]*")/gs) ?? [];
      return selects.some((s) => EMBED_SIN_FK.test(s));
    });
    expect(
      culpables.map((f) => f.replace(RAIZ, 'src/')),
      'estos `select` devuelven PGRST201 contra la base real: hay dos FK entre viaje y liquidacion (mig. 0028) y PostgREST no elige',
    ).toEqual([]);
  });

  it('/mis-viajes nombra el FK, igual que lib/cuadra/chofer.ts', () => {
    const pagina = readFileSync(`${RAIZ}app/mis-viajes/page.tsx`, 'utf8');
    expect(pagina).toMatch(/liquidacion!liquidacion_viaje_id_fkey\(/);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LAS DOS CAPAS, Y EL ALTA A MEDIAS.
// ═══════════════════════════════════════════════════════════════════════════

describe('/mis-viajes · aislamiento y alta incompleta', () => {
  const pagina = readFileSync(`${RAIZ}app/mis-viajes/page.tsx`, 'utf8');
  // El marcado vive aparte para poder MIRARLO en un preview que importe el
  // componente REAL y no una copia (regla de verificación de CLAUDE.md).
  const vista = readFileSync(`${RAIZ}app/mis-viajes/vista.tsx`, 'utf8');

  it('la consulta acota por tenant Y por operador, no solo confía en RLS', () => {
    // `operador_ve_su_viaje` (0045) filtra SOLO por `operador_id` — su `qual`
    // en la base es `operador_id = get_user_operador_id()`, sin tenant. Así
    // que el `.eq('tenant_id')` de la página no duplica a la policy: es la
    // única línea que ata la lista a la flota.
    expect(pagina).toMatch(/\.eq\('tenant_id', tenantId\)/);
    expect(pagina).toMatch(/\.eq\('operador_id', operadorId\)/);
  });

  it('la puerta es requireOperador y lleva SU destino, no la constante vieja', () => {
    expect(pagina).toMatch(/requireOperador\('\/mis-viajes'\)/);
    expect(pagina).not.toMatch(/requireSessionTenant/);
  });

  it('un chofer sin flota lee "tu alta está incompleta", no "no tienes viajes"', () => {
    // `app_user.tenant_id` es nullable y `requireOperador` no lo exige: solo
    // exige `operador_id`. Con la consulta acotada por tenant, esa cuenta
    // saldría SIEMPRE vacía y la pantalla afirmaría algo falso — y además lo
    // mandaría a esperar en vez de a hablarle a su oficina.
    expect(pagina).toMatch(/if \(!s\.tenantId\)/);
    expect(pagina).toMatch(/<AltaIncompleta \/>/);
    expect(vista).toMatch(/no está ligada a una flota/);
    // El aviso va ANTES de la consulta: si fuera después, la lista vacía ya
    // se habría pintado.
    expect(pagina.indexOf('if (!s.tenantId)')).toBeLessThan(pagina.indexOf('await getMisViajes('));
  });

  it('el aviso de alta incompleta NO se confunde con el de lista vacía', () => {
    // Dos textos distintos para dos causas distintas, y dos componentes
    // distintos para no poder mezclarlos. Si dijeran lo mismo, la distinción
    // existiría en el código y no en la pantalla, que es donde hace falta.
    expect(vista).toMatch(/Todavía no tienes viajes cerrados/);
    expect(vista).toMatch(/complete tu alta/);
    expect(pagina).toMatch(/<SinViajesCerrados \/>/);
    expect(pagina).toMatch(/<AltaIncompleta \/>/);
  });
});
