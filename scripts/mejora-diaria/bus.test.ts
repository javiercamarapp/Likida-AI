/* eslint-disable security/detect-non-literal-fs-filename -- fixtures propias bajo mkdtemp */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A37-S04-07 — el bus (lado Mac) abortaba con un traceback si la red fallaba entre «tomar» y «resolver»
// (esas llamadas estaban fuera del try) y armaba el JSON de `corrida-inicio` por interpolación.
// La prueba corre el script REAL contra un servidor local que imita la API de workers.

const limpiar: Array<() => void> = [];
afterEach(() => { for (const f of limpiar.splice(0)) f(); });

type Llamada = { accion: string; cuerpo: Record<string, unknown> };

async function correr(args: string[], opciones: {
  ordenes?: Array<Record<string, unknown>>;
  /** Acciones que responden 500. */
  falla?: Set<string>;
}) {
  const llamadas: Llamada[] = [];
  const servidor: Server = createServer((req, res) => {
    let crudo = '';
    req.on('data', (d) => { crudo += d; });
    req.on('end', () => {
      const accion = (req.url ?? '').split('/').pop() ?? '';
      let cuerpo: Record<string, unknown> = {};
      try { cuerpo = crudo ? JSON.parse(crudo) : {}; } catch { cuerpo = { __invalido: crudo }; }
      llamadas.push({ accion, cuerpo });
      const clave = `${accion}:${String(cuerpo.id ?? '')}`;
      if (opciones.falla?.has(accion) || opciones.falla?.has(clave)) { res.statusCode = 500; res.end('{}'); return; }
      res.setHeader('content-type', 'application/json');
      if (accion === 'ordenes') res.end(JSON.stringify({ ordenes: opciones.ordenes ?? [] }));
      else if (accion === 'ordenes-claim') res.end(JSON.stringify({ tomada: true }));
      else if (accion === 'corrida-inicio') res.end(JSON.stringify({ id: 'corrida-1' }));
      else res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
  const puerto = (servidor.address() as { port: number }).port;
  const raiz = mkdtempSync(join(tmpdir(), 'bus-test-'));
  limpiar.push(() => { servidor.close(); rmSync(raiz, { recursive: true, force: true }); });
  mkdirSync(join(raiz, 'scripts/mejora-diaria'), { recursive: true });
  writeFileSync(join(raiz, 'scripts/mejora-diaria/bus.sh'), readFileSync('scripts/mejora-diaria/bus.sh'));
  writeFileSync(join(raiz, '.env.local'), `LIKIDA_WORKER_KEY=lkw_prueba\nLIKIDA_WORKER_URL=http://127.0.0.1:${puerto}\n`);
  const hijo = spawn('bash', [join(raiz, 'scripts/mejora-diaria/bus.sh'), ...args], { env: { ...process.env, BUS_REINTENTO_ESPERA: '0' } });
  let stdout = '', stderr = '';
  hijo.stdout.on('data', (d) => { stdout += d; });
  hijo.stderr.on('data', (d) => { stderr += d; });
  const codigo: number | null = await new Promise((r) => hijo.on('close', r));
  return { codigo, stdout, stderr, llamadas };
}

const ORDEN = (id: string, extra: Record<string, unknown> = {}) => ({ id, tipo: 'nota', rutina: null, payload: { texto: 'x' }, ...extra });

describe('A37-S04-07: bus.sh ordenes aguanta cortes de red', () => {
  it('un fallo HTTP al TOMAR una orden no tumba el script con traceback: sigue con la siguiente', async () => {
    const r = await correr(['ordenes'], { ordenes: [ORDEN('a'), ORDEN('b')], falla: new Set(['ordenes-claim:a']) });
    expect(r.stderr + r.stdout).not.toContain('Traceback');
    const claims = r.llamadas.filter((l) => l.accion === 'ordenes-claim').map((l) => l.cuerpo.id);
    expect(claims).toEqual(['a', 'b']);
    expect(r.llamadas.some((l) => l.accion === 'ordenes-resolver' && l.cuerpo.id === 'b')).toBe(true);
    // 'a' no se resuelve: nunca se tomó (queda pendiente para la siguiente vuelta).
    expect(r.llamadas.some((l) => l.accion === 'ordenes-resolver' && l.cuerpo.id === 'a')).toBe(false);
  }, 30_000);

  it('un fallo al RESOLVER se reintenta y no deja un traceback', async () => {
    const r = await correr(['ordenes'], { ordenes: [ORDEN('a')], falla: new Set(['ordenes-resolver']) });
    expect(r.stderr + r.stdout).not.toContain('Traceback');
    expect(r.llamadas.filter((l) => l.accion === 'ordenes-resolver').length).toBeGreaterThanOrEqual(2);
    expect(r.stdout + r.stderr).toMatch(/no se pudo resolver|sin resolver/i);
  }, 30_000);

  it('una rutina con ruta ("../x") en correr_ahora se rechaza como fallida, sin tocar launchctl', async () => {
    const r = await correr(['ordenes'], { ordenes: [ORDEN('a', { tipo: 'correr_ahora', rutina: '../../etc/x' })] });
    const res = r.llamadas.find((l) => l.accion === 'ordenes-resolver');
    expect(res?.cuerpo.ok).toBe(false);
    expect(String(res?.cuerpo.resultado)).toMatch(/inválid/);
  }, 30_000);

  it('el listado caído termina con un mensaje claro, sin traceback', async () => {
    const r = await correr(['ordenes'], { falla: new Set(['ordenes']) });
    expect(r.stderr + r.stdout).not.toContain('Traceback');
    expect(r.codigo).not.toBe(0);
  }, 30_000);
});

describe('A37-S04-07: corrida-inicio arma el JSON bien aunque la rutina traiga comillas', () => {
  it('manda un JSON válido con la rutina intacta', async () => {
    const r = await correr(['corrida-inicio', 'ru"ti\\na'], {});
    const ll = r.llamadas.find((l) => l.accion === 'corrida-inicio');
    expect(ll?.cuerpo.__invalido).toBeUndefined();
    expect(ll?.cuerpo.rutina).toBe('ru"ti\\na');
    expect(r.stdout.trim()).toBe('corrida-1');
  }, 30_000);
});
