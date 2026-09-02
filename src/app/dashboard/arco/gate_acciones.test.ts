// ═══════════════════════════════════════════════════════════════════════════
// AUDITORÍA 24 — LAS TRES ACCIONES DE ARCO SE GATEAN POR ROL.
//
// `resolverTenantEfectivo` gatea la PÁGINA, pero una server action es un
// endpoint POST que no hereda esa puerta: las tres acciones de esta pantalla
// solo corrían `requireSessionTenant` («hay sesión y tiene flota»). Un
// encargado —que sí ve el área `operacion`, y con ella esta ruta— podía
// resolver una solicitud ARCO, ejecutar la cancelación (anonimiza al titular
// y BORRA sus conversaciones) y registrar una oposición con un POST a mano.
//
// La página es un server component con sesión y no se monta suelta, así que
// se lee el fuente — mismo patrón que `fundamento_legal.test.ts` de al lado.
// ═══════════════════════════════════════════════════════════════════════════
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { puedeAdministrar } from '@/lib/auth/permisos';

// La ruta la arma `import.meta.url`, no entrada de nadie: es el archivo
// de al lado. La regla no distingue eso de un path de usuario.
// eslint-disable-next-line security/detect-non-literal-fs-filename
const PAGINA = readFileSync(fileURLToPath(new URL('./page.tsx', import.meta.url)), 'utf8');
const RUTA = '/dashboard/arco';

describe('las server actions de /dashboard/arco', () => {
  it('hay exactamente tres, y las TRES traen el gate (ni una sin él)', () => {
    const conSesion = PAGINA.match(/await requireSessionTenant\(RUTA\)/g) ?? [];
    const conGate = PAGINA.match(/if \(!puedeResponderArco\(s\.rol\)\) return \{ error: NO_AUTORIZADO \};/g) ?? [];
    expect(conSesion).toHaveLength(3);
    expect(conGate).toHaveLength(3);
  });

  it('el gate exige las DOS cosas: ver la ruta y administrar la cuenta', () => {
    expect(PAGINA).toContain('return puedeVerRuta(rol, RUTA) && puedeAdministrar(rol);');
  });
});

describe('a quién deja fuera ese gate (la razón de que sean dos preguntas)', () => {
  it('el encargado VE la pantalla pero no responde: es el caso que estaba abierto', () => {
    expect(puedeVerRuta('encargado', RUTA)).toBe(true);
    expect(puedeAdministrar('encargado')).toBe(false);
  });

  it('el dueño y el superadmin sí responden', () => {
    for (const rol of ['flota_admin', 'superadmin']) {
      expect(puedeVerRuta(rol, RUTA)).toBe(true);
      expect(puedeAdministrar(rol)).toBe(true);
    }
  });

  it('el contador ni siquiera ve la ruta: la primera pregunta ya lo para', () => {
    expect(puedeVerRuta('contador', RUTA)).toBe(false);
  });
});
