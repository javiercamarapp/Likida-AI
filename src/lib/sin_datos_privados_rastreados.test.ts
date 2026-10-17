import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

// ═══════════════════════════════════════════════════════════════════════════
// EL REPO ES PÚBLICO: NADA PRIVADO SE RASTREA.
//
// Auditoría ola 1 (hallazgos 0 y 1): `staging_canacar/` (1,018 archivos, ~2,900
// correos y 867 nombres de director de terceros que no consintieron) y los
// informes `docs/auditoria-*/` (mapas de ataque con riesgos abiertos) estaban
// RASTREADOS en un repo público, aunque `.gitignore` ya declaraba
// `docs/auditoria-*/`: un .gitignore no des-rastrea lo que ya estaba en el índice.
//
// Esta prueba mira el ÍNDICE de git (no el disco) y el .gitignore. Si alguien
// vuelve a hacer `git add -f` o `git add -A` con el .gitignore roto, CI falla.
//
// La purga del HISTORIAL (git filter-repo + force-push) NO se hace aquí: la
// decide Javier. Ver ~/likida-loop/runbook-purga-historial.md.
// ═══════════════════════════════════════════════════════════════════════════

const PROHIBIDOS = [
  'staging_canacar',
  'docs/auditoria-*',
  'scripts/cosecha',
  'docs/comercial',
  'docs/REPORTE-ESTADO.md',
  'PROMPT-SESION-NUEVA.md',
  // Retirado del repo público el 15-oct-2026 (limpieza «solo lo que pertenece al funcionamiento de Likida»):
  // estrategia, auditorías, demo con nombres, cosecha/outreach, ensayos reales y skills ajenos.
  'docs/demo', ':(exclude)docs/demo/a3-salida-tms.md',
  'docs/asistencia', 'docs/escala-15k.md', 'docs/escala-50k', 'docs/fiscalista', 'docs/perfil',
  'docs/e2e', 'docs/qa', 'docs/pruebas-aud24.md', 'docs/costos-reales-flota-mx-2026.md', 'docs/demo-5k.md',
  'docs/demo-5k-modelo.md', 'docs/demo-facturacion-lunes.md', 'docs/legal/PENDIENTES-ABOGADO.md',
  'docs/legal/00-CHECKLIST-ENTERPRISE.md', 'MARCA.md', 'skill-observations', '.superpowers',
  'scripts/outreach', 'scripts/auditoria', 'scripts/mejora-diaria/encargos', 'scripts/mejora-diaria/*.plist',
  'pruebas-manuales/ensayo', '.agents', 'skills-lock.json', 'vitest.audit.config.ts',
  '.claude/skills/auditoria-diaria', '.claude/skills/ensayo-demo', '.claude/skills/salud-del-repo',
  // (rutas del kit de demo anterior, armadas por partes para que este archivo no nombre al cliente)
  ['scripts/demo/innovat', 'ivos'].join(''), ['src/lib/likida/demo_innovat', 'ivos'].join(''),
  'docs/operacion/EVIDENCIA-CANDIDATO-2026-09-05.json', 'docs/operacion/REVISION-CODEQL-PR332.md',
  'docs/operacion/hallazgos-ola1-agentes-28-30.md', 'docs/operacion/pendientes-seguridad-w2.md',
  'docs/operacion/DIAGNOSTICO-PREFLIGHT-SUPABASE.md', 'docs/operacion/INVENTARIO-CODIGO-PANTALLA.md',
  'docs/operacion/impacto-tarjeta-no-empresa.sql',
  // docs/conocimiento: solo se queda lo operativo (runbook de despliegue, anexo de subencargados, guía de Meta,
  // y las carpetas fiscal/ y legal/). Todo lo demás es conocimiento de negocio.
  'docs/conocimiento',
  ':(exclude)docs/conocimiento/DEPLOY.md',
  ':(exclude)docs/conocimiento/52-anexo-subencargados.md',
  ':(exclude)docs/conocimiento/CONFIGURAR-META.md',
  ':(exclude)docs/conocimiento/fiscal',
  ':(exclude)docs/conocimiento/legal',
];

function rastreados(): string[] | null {
  try {
    const salida = execFileSync('git', ['ls-files', '-z', '--', ...PROHIBIDOS], {
      cwd: process.cwd(),
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    return salida.split('\0').filter(Boolean);
  } catch {
    return null; // sin git (tarball): no hay índice que auditar
  }
}

describe('el índice de git no contiene datos privados', () => {
  it('ningún archivo de staging_canacar/, docs/auditoria-*/, salida-prospectos/ ni material comercial está rastreado', () => {
    const lista = rastreados();
    if (lista === null) return;
    expect(
      lista,
      lista.length === 0 ? '' :
        `Hay ${lista.length} archivos privados rastreados en un repo PÚBLICO (p. ej. ${lista[0]}). ` +
        'Corrige con `git rm -r --cached <ruta>`; no uses `git add -f`.',
    ).toEqual([]);
  });

  it('.gitignore declara cada ruta privada', () => {
    const gi = readFileSync(join(process.cwd(), '.gitignore'), 'utf8')
      .split('\n').map((l) => l.trim());
    for (const patron of [
      'staging_canacar/', 'docs/auditoria-*/', 'docs/comercial/', 'scripts/cosecha/',
      'scripts/outreach/', 'scripts/auditoria/', 'scripts/mejora-diaria/encargos/', 'scripts/mejora-diaria/*.plist',
      'pruebas-manuales/ensayo/', 'docs/demo/', 'docs/asistencia/', 'docs/escala-50k/', 'docs/qa/',
      'MARCA.md', 'skill-observations/', '.superpowers/', '.agents/', 'skills-lock.json',
      'docs/conocimiento/*', '!docs/conocimiento/DEPLOY.md', '!docs/conocimiento/52-anexo-subencargados.md',
      '!docs/conocimiento/CONFIGURAR-META.md', '!docs/conocimiento/fiscal/', '!docs/conocimiento/legal/',
    ]) {
      expect(gi, `falta ${patron} en .gitignore`).toContain(patron);
    }
  });

  it('ningún archivo rastreado nombra al cliente de la demo anterior ni usa su esquema o GUC', () => {
    // El patrón se arma por partes para que ESTE archivo no se encuentre a sí mismo.
    const patron = [['innovat', 'ivos'], ['inn\\.', '(tenant|ancla|red_privada)']].map((p) => p.join('')).join('|');
    let salida = '';
    try {
      salida = execFileSync('git', ['grep', '-I', '-l', '-i', '-E', patron, '--', '.', ':(exclude)src/lib/sin_datos_privados_rastreados.test.ts'], {
        cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch (e) {
      const err = e as { status?: number };
      if (err.status === 1) return; // git grep sale 1 cuando no encuentra nada
      return; // sin git (tarball): no hay índice que auditar
    }
    expect(salida.split('\n').filter(Boolean), 'archivos rastreados que nombran al cliente retirado').toEqual([]);
  });

  it('el prefijo de folio retirado solo sobrevive en la compatibilidad de esFolioSimulado y sus pruebas', () => {
    const prefijo = ['IN', 'N-'].join('');
    let salida = '';
    try {
      salida = execFileSync('git', ['grep', '-I', '-l', prefijo, '--', '.', ':(exclude)src/lib/sin_datos_privados_rastreados.test.ts'], {
        cwd: process.cwd(), encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      });
    } catch {
      return;
    }
    const permitidos = new Set([
      'src/lib/likida/conductor/tablero.ts',
      'src/app/dashboard/agentes/conductores/tablero-hitos.test.tsx',
    ]);
    const fuera = salida.split('\n').filter(Boolean).filter((f) => !permitidos.has(f));
    expect(fuera, 'el prefijo de folio retirado reapareció fuera de la compatibilidad').toEqual([]);
  });
});
