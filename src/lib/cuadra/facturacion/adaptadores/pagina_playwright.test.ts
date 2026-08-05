import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, type Page } from 'playwright-core';
import {
  PaginaPlaywright,
  SesionNavegador,
  conNavegador,
  BANDERAS_CONTENEDOR,
  type OpcionesPagina,
} from './pagina_playwright';
import { AdaptadorCapufe, type PaginaCapufe, type DatosReceptorCapufe } from './capufe';
import type { PaginaPortal } from './playwright_base';

// ═══════════════════════════════════════════════════════════════════════════
// ESTO CORRE UN CHROMIUM DE VERDAD. Contra un portal de mentira.
//
// ── POR QUÉ NO SE PRUEBA CONTRA EL PORTAL REAL ───────────────────────────
//
// Porque apretar "Facturar" en CAPUFE emite un CFDI ante el SAT y no se
// deshace: una suite que corre en cada push no puede tener eso dentro. Y probar
// solo el modo `ensayo` contra el portal real tampoco sirve: seguiría siendo
// red, seguiría siendo lento y seguiría rompiéndose el día que el portal cambie
// una clase — o sea, fallaría por algo que no es el código bajo prueba.
//
// ── ENTONCES QUÉ PRUEBA ESTO ─────────────────────────────────────────────
//
// El MOTOR. Se levanta un servidor HTTP local con una página que tiene la misma
// FORMA que la de CAPUFE —sus ids, dos `<select>` que llegan vacíos y se pueblan
// por AJAX, un botón que agrega filas a una tabla de Código | Plaza de cobro |
// Fecha | Costo— y se corre Playwright de verdad contra ella. Eso prueba lo que
// puede fallar de nuestro lado:
//
//   · que los formatos de selector del mapeo (`xpath=`, `:has-text()`, cadenas
//     con `nth-child`) los resuelva el motor de locators,
//   · que escribir dispare `input` y `change` y no solo cambie `.value`,
//   · que un `<select>` que tarda en poblarse se espere preguntando,
//   · que un tope corte y no cuelgue,
//   · que el navegador se cierre aunque el trabajo lance,
//   · que un lote use UN navegador y no uno por ticket.
//
// ── LO QUE ESTE MONTAJE **NO** PUEDE PROBAR ──────────────────────────────
//
//   · Que los selectores de `SELECTORES_CAPUFE` sean los del portal real. La
//     página de prueba los copia, así que si el portal cambia mañana, esto sigue
//     verde. Eso lo caza el pre-vuelo en la primera corrida real, no una prueba.
//   · Que CAPUFE acepte lo que le mandamos: su validación de RFC, sus reglas de
//     código, su catálogo de regímenes.
//   · CAPTCHA. Aquí no hay ninguno; si el portal empieza a pedirlo, esta suite
//     no se entera.
//   · Latencia, bloqueo por IP, cambios de sesión, rate limiting.
//   · Que Chromium arranque en Vercel. Aquí arranca desde la caché de
//     `~/Library/Caches/ms-playwright`, que en la función no existe.
// ═══════════════════════════════════════════════════════════════════════════

const { logger } = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock('@/lib/logger', () => ({ logger }));

/**
 * Con navegador, red y AJAX de por medio, el default de vitest (5 s) no alcanza:
 * una sesión completa de CAPUFE contra el portal local son ~3.9 s.
 */
const HOLGURA = 30_000;

// ═══════════════════════════════════════════════════════════════════════════
// EL PORTAL DE MENTIRA
// ═══════════════════════════════════════════════════════════════════════════

/** El catálogo tarda: es lo que obliga a ESPERAR el `<select>` en vez de leerlo. */
const RETRASO_CATALOGO_MS = 400;
const RETRASO_VALIDAR_MS = 120;

const CODIGO_OK = 'OK1234567890123456';
const CODIGO_RECHAZADO = 'NO1234567890123456';
const COSTO_PORTAL = '$ 123.45';
const PLAZA = 'Tepotzotlán';
const UUID_FALSO = 'A1B2C3D4-E5F6-4A7B-8C9D-0E1F2A3B4C5D';
const RECHAZO_DEL_PORTAL = 'El código no existe o ya fue facturado.';

/**
 * La misma FORMA que la página de CAPUFE: sus ids, sus dos `<select>` con
 * buscador delante, su tabla de cuatro columnas y su checkbox de partidos.
 *
 * Dos detalles copiados a propósito porque son los que rompen el motor:
 *
 *  1. Los catálogos se piden AL CAMBIAR EL RFC, no al cargar. Si `escribir` no
 *     emitiera `change`, los dos `<select>` se quedarían vacíos para siempre.
 *  2. El `<span class="uuid">` NO EXISTE hasta que se emite. Un contenedor vacío
 *     pre-pintado se leería como '' de inmediato y el adaptador diría "no se
 *     pudo confirmar el UUID" sin haber esperado nada.
 */
const HTML = `<!doctype html>
<html lang="es"><head><meta charset="utf-8"><title>Facturación rápida (prueba)</title></head>
<body>
<h1>Facturación rápida</h1>
<form id="f" onsubmit="return false">
  <label for="rfc">RFC</label><input id="rfc" name="receptor.rfc" type="text">
  <label for="nombre">Nombre o Razón Social</label><input id="nombre" type="text">
  <label for="domicilioFiscalReceptor">Código Postal</label>
  <input id="domicilioFiscalReceptor" type="text" maxlength="5">

  <div class="campo">
    <label>Régimen Fiscal</label>
    <input type="text" class="buscador" placeholder="Buscar régimen">
    <select name="receptor.regimenFiscalReceptor" id="reg"><option value="">Seleccione</option></select>
  </div>

  <div class="campo">
    <label>Uso del CFDI</label>
    <input type="text" class="buscador" placeholder="Buscar uso">
    <select name="receptor.usoCfdi" id="uso"><option value="">Seleccione</option></select>
  </div>

  <label for="correo">Correo electrónico</label><input id="correo" type="email">
  <label><input type="checkbox" id="cb1"> Complemento para la facturación de partidos políticos</label>
  <span id="estadoCb1">sin marcar</span>

  <label for="codigo">Código de 18 caracteres</label><input id="codigo" type="text" maxlength="18">
  <button type="button" id="validar">Validar Código</button>

  <div class="alert-danger" id="aviso"></div>

  <h2>CÓDIGOS AGREGADOS</h2>
  <table id="agregados">
    <thead><tr><th>Código</th><th>Plaza de cobro</th><th>Fecha</th><th>Costo</th></tr></thead>
    <tbody></tbody>
  </table>

  <button type="button" id="facturar">Facturar</button>
  <div id="salida"></div>
  <div id="eventos"></div>
  <div id="vacio"></div>
</form>
<script>
var ev = document.getElementById('eventos');
function anota(id, t) { ev.textContent = (ev.textContent + ' ' + id + ':' + t).trim(); }
['rfc','nombre','domicilioFiscalReceptor','correo','codigo','reg','uso'].forEach(function (id) {
  var n = document.getElementById(id);
  ['input','change'].forEach(function (t) { n.addEventListener(t, function () { anota(id, t); }); });
});
document.getElementById('cb1').addEventListener('change', function () {
  document.getElementById('estadoCb1').textContent = this.checked ? 'MARCADO' : 'sin marcar';
});
var pedido = false;
document.getElementById('rfc').addEventListener('change', function () {
  if (pedido) return;
  pedido = true;
  fetch('/catalogos').then(function (r) { return r.json(); }).then(function (d) {
    llenar('reg', d.regimenes);
    llenar('uso', d.usos);
  });
});
function llenar(id, lista) {
  var s = document.getElementById(id);
  lista.forEach(function (o) {
    var op = document.createElement('option');
    op.value = o.clave;
    op.textContent = o.clave + ' - ' + o.nombre;
    s.appendChild(op);
  });
}
document.getElementById('validar').addEventListener('click', function () {
  var c = document.getElementById('codigo').value;
  document.getElementById('aviso').textContent = '';
  fetch('/validar?codigo=' + encodeURIComponent(c)).then(function (r) { return r.json(); }).then(function (d) {
    if (!d.ok) { document.getElementById('aviso').textContent = d.error; return; }
    var tr = document.createElement('tr');
    [d.codigo, d.plaza, d.fecha, d.costo].forEach(function (v) {
      var td = document.createElement('td');
      td.textContent = v;
      tr.appendChild(td);
    });
    document.querySelector('#agregados tbody').appendChild(tr);
    document.getElementById('codigo').value = '';
  });
});
document.getElementById('facturar').addEventListener('click', function () {
  if (!document.querySelectorAll('#agregados tbody tr').length) {
    document.getElementById('aviso').textContent = 'No hay códigos agregados.';
    return;
  }
  setTimeout(function () {
    var s = document.createElement('span');
    s.className = 'uuid';
    s.textContent = '${UUID_FALSO}';
    document.getElementById('salida').appendChild(s);
  }, 250);
});
</script>
</body></html>`;

interface PortalDePrueba {
  url(ruta?: string): string;
  cerrar(): Promise<void>;
}

async function levantarPortal(): Promise<PortalDePrueba> {
  const server: Server = createServer((req, res) => {
    const u = new URL(req.url ?? '/', 'http://127.0.0.1');

    // ACEPTA Y CALLA. Es el peor portal posible y el que justifica los topes: no
    // rechaza la conexión (eso se notaría), se queda con ella para siempre.
    if (u.pathname === '/nunca') return;

    if (u.pathname === '/catalogos') {
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          regimenes: [
            { clave: '601', nombre: 'General de Ley Personas Morales' },
            { clave: '612', nombre: 'Personas Físicas con Actividades Empresariales' },
          ],
          usos: [
            { clave: 'G03', nombre: 'Gastos en general' },
            { clave: 'G01', nombre: 'Adquisición de mercancías' },
          ],
        }));
      }, RETRASO_CATALOGO_MS);
      return;
    }

    if (u.pathname === '/validar') {
      const codigo = (u.searchParams.get('codigo') ?? '').toUpperCase();
      setTimeout(() => {
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
        res.end(codigo.startsWith('OK')
          ? JSON.stringify({ ok: true, codigo, plaza: PLAZA, fecha: '2026-08-01', costo: COSTO_PORTAL })
          : JSON.stringify({ ok: false, error: RECHAZO_DEL_PORTAL }));
      }, RETRASO_VALIDAR_MS);
      return;
    }

    if (u.pathname === '/facturacionrapida') {
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(HTML);
      return;
    }

    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    res.end('no existe');
  });

  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const puerto = (server.address() as AddressInfo).port;

  return {
    url: (ruta = '/facturacionrapida') => `http://127.0.0.1:${puerto}${ruta}`,
    cerrar: () =>
      new Promise<void>((r) => {
        // Sin esto, la petición a `/nunca` deja el servidor sin cerrar y la suite
        // se queda colgada al final — el mismo fallo que se está probando.
        server.closeAllConnections();
        server.close(() => r());
      }),
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// EL MONTAJE
// ═══════════════════════════════════════════════════════════════════════════

let portal: PortalDePrueba;
let sesion: SesionNavegador;

beforeAll(async () => {
  portal = await levantarPortal();
  // UN navegador para todo el archivo: es la misma decisión que en producción y
  // sin ella estas pruebas tardarían un arranque de Chromium cada una.
  sesion = await SesionNavegador.abrir();
}, HOLGURA);

afterAll(async () => {
  await sesion?.cerrar();
  await portal?.cerrar();
});

/** Una pestaña nueva, sin navegar. */
function nuevaPagina(op?: OpcionesPagina): Promise<PaginaPlaywright> {
  return sesion.fabrica(op)();
}

/** Una pestaña ya abierta en el portal de prueba. */
async function abrirEnPortal(op?: OpcionesPagina): Promise<PaginaPlaywright> {
  const p = await nuevaPagina(op);
  await p.abrir(portal.url());
  return p;
}

// ═══════════════════════════════════════════════════════════════════════════
describe('los formatos de selector que usa el mapeo de CAPUFE', () => {
  it('resuelve id, atributo, xpath con preceding-sibling, :has-text y cadenas con nth-child', async () => {
    const p = await abrirEnPortal();
    try {
      // Los del DOM real de CAPUFE, verificados uno por uno.
      expect(await p.existe('#rfc')).toBe(true);
      expect(await p.existe('#domicilioFiscalReceptor')).toBe(true);
      expect(await p.existe('#cb1')).toBe(true);
      expect(await p.existe('select[name="receptor.regimenFiscalReceptor"]')).toBe(true);
      expect(await p.existe('select[name="receptor.usoCfdi"]')).toBe(true);

      // El único que sabe mirar hacia ATRÁS. CSS no puede, y el buscador del
      // desplegable está ANTES del `<select>`.
      expect(await p.existe('xpath=//select[@name="receptor.regimenFiscalReceptor"]/preceding-sibling::input[1]')).toBe(true);

      // Extensión de Playwright: casa por subcadena del texto renderizado.
      expect(await p.existe('button:has-text("Validar Código")')).toBe(true);
      expect(await p.existe('button:has-text("Facturar")')).toBe(true);
      expect(await p.existe('table:has-text("Plaza de cobro")')).toBe(true);

      // Y lo que no está, no está.
      expect(await p.existe('#no-existe-este-campo')).toBe(false);
      expect(await p.existe('button:has-text("Cancelar CFDI")')).toBe(false);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('el buscador que devuelve el xpath es el input que precede a SU select', async () => {
    const p = await abrirEnPortal();
    try {
      // Se escribe por el xpath y se lee por otro camino: si el xpath hubiera
      // resuelto al buscador del otro desplegable, esto lo delata.
      await p.escribir('xpath=//select[@name="receptor.usoCfdi"]/preceding-sibling::input[1]', 'gastos');
      const valores = await p.pagina.locator('input.buscador').evaluateAll((els) =>
        els.map((e) => (e as HTMLInputElement).value));
      expect(valores).toEqual(['', 'gastos']);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('existe() NO espera: seis selectores ausentes se resuelven en menos de un segundo', async () => {
    const p = await abrirEnPortal();
    try {
      const t0 = Date.now();
      for (const sel of ['iframe[src*="recaptcha/api2/anchor"]', 'iframe[src*="recaptcha/api2/bframe"]',
        'iframe[title*="recaptcha" i]', '.g-recaptcha', '.h-captcha', 'img[src*="captcha" i]']) {
        expect(await p.existe(sel)).toBe(false);
      }
      // Es el chequeo de CAPTCHA de `capufe.ts`, y corre antes de CADA código.
      // Si esperara tres segundos por ausente serían ~150 s por lote de ocho.
      expect(Date.now() - t0).toBeLessThan(1_000);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('escribir', () => {
  it('dispara input Y change — no solo cambia el valor', async () => {
    const p = await abrirEnPortal();
    try {
      await p.escribir('#rfc', 'GMX0902279I1');
      await p.escribir('#nombre', 'TRANSPORTES DEL BAJIO SA DE CV');
      const eventos = await p.leerTexto('#eventos');
      expect(eventos).toContain('rfc:input');
      expect(eventos).toContain('rfc:change');
      expect(eventos).toContain('nombre:input');
      expect(eventos).toContain('nombre:change');
      expect(await p.pagina.locator('#rfc').inputValue()).toBe('GMX0902279I1');
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('`fill` de Playwright NO emite `change` por su cuenta — por eso se emite a mano', async () => {
    // Caracterización, no aspiración: esta prueba fija el comportamiento MEDIDO
    // de Playwright 1.62. El día que `fill` empiece a emitir `change`, esto se
    // pone en rojo y hay que quitar el `dispatchEvent` para no emitirlo doble.
    const p = await abrirEnPortal();
    try {
      await p.pagina.locator('#rfc').fill('GMX0902279I1');
      const eventos = await p.leerTexto('#eventos');
      expect(eventos).toContain('rfc:input');
      expect(eventos).not.toContain('rfc:change');
      // Y sin `change` el portal no pide su catálogo: los `<select>` se quedan
      // vacíos y el diagnóstico culparía al portal.
      expect(await p.opciones('select[name="receptor.regimenFiscalReceptor"]')).toEqual(['']);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('reemplaza el contenido en vez de concatenar', async () => {
    const p = await abrirEnPortal();
    try {
      await p.escribir('#codigo', 'PRIMERO');
      await p.escribir('#codigo', CODIGO_OK);
      expect(await p.pagina.locator('#codigo').inputValue()).toBe(CODIGO_OK);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('LANZA cuando el selector no está — el contrato de `PaginaPortal`', async () => {
    const p = await abrirEnPortal({ topes: { accion: 600 } });
    try {
      await expect(p.escribir('#campo-que-no-existe', 'x')).rejects.toThrow();
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('los <select> que llegan vacíos y se pueblan por AJAX', () => {
  it('se espera preguntando: opciones() pasa de vacío a poblado y seleccionar() prende el control', async () => {
    const p = await abrirEnPortal();
    const sel = 'select[name="receptor.regimenFiscalReceptor"]';
    try {
      // Antes de tocar el RFC el portal ni siquiera ha pedido su catálogo.
      expect(await p.opciones(sel)).toEqual(['']);

      await p.escribir('#rfc', 'GMX0902279I1');
      // Y ni aun así está: el catálogo tarda. Leer aquí y creerse el resultado es
      // exactamente el error que `esperarOpcion()` evita.
      expect(await p.opciones(sel)).toEqual(['']);

      const t0 = Date.now();
      let opciones: string[] = [];
      for (let i = 0; i < 40; i++) {
        opciones = await p.opciones(sel);
        if (opciones.includes('601')) break;
        await new Promise((r) => setTimeout(r, 100));
      }
      expect(opciones).toEqual(['', '601', '612']);
      expect(Date.now() - t0).toBeGreaterThanOrEqual(RETRASO_CATALOGO_MS - 200);

      await p.seleccionar(sel, '601');
      expect(await p.valorSeleccionado(sel)).toBe('601');
      // `selectOption` sí emite los dos eventos por su cuenta (medido).
      const eventos = await p.leerTexto('#eventos');
      expect(eventos).toContain('reg:input');
      expect(eventos).toContain('reg:change');
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('seleccionar() lanza si el portal no ofrece esa clave', async () => {
    const p = await abrirEnPortal({ topes: { accion: 800 } });
    const sel = 'select[name="receptor.regimenFiscalReceptor"]';
    try {
      await p.escribir('#rfc', 'GMX0902279I1');
      for (let i = 0; i < 40 && !(await p.opciones(sel)).includes('601'); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      // 626 (RESICO) es legal, pero este portal no lo ofrece. Que reviente aquí
      // es lo que impide emitir un CFDI con otro régimen.
      await expect(p.seleccionar(sel, '626')).rejects.toThrow();
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('opciones() y valorSeleccionado() no revientan con un selector ausente', async () => {
    const p = await abrirEnPortal();
    try {
      // `[]` = "el AJAX no ha llegado", que es como lo lee el adaptador.
      expect(await p.opciones('select[name="no.existe"]')).toEqual([]);
      // `null` = "no se pudo verificar", que el adaptador anota en el log.
      expect(await p.valorSeleccionado('select[name="no.existe"]')).toBeNull();
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('leerTexto y la tabla de CÓDIGOS AGREGADOS', () => {
  it('null si no está, cadena vacía si está vacío, y el texto con acentos si está', async () => {
    const p = await abrirEnPortal({ topes: { lectura: 700 } });
    try {
      expect(await p.leerTexto('#no-existe')).toBeNull();
      // La diferencia importa: `''` es un cuadro de error presente y sin quejas;
      // `null` es un cuadro que no está. Aplanar las dos convertiría cada portal
      // sin cuadro de error en un rechazo permanente.
      expect(await p.leerTexto('#vacio')).toBe('');
      expect(await p.leerTexto('h1')).toBe('Facturación rápida');
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('lee la fila que el portal agregó, por la cadena de selectores del adaptador', async () => {
    const p = await abrirEnPortal({ topes: { lectura: 3_000 } });
    const celda = (fila: number, col: number) =>
      `table:has-text("Plaza de cobro") tbody tr:nth-child(${fila}) td:nth-child(${col})`;
    try {
      await p.escribir('#codigo', CODIGO_OK);
      await p.hacerClic('button:has-text("Validar Código")');

      // La fila llega por AJAX DESPUÉS del clic: `leerTexto` espera a que el
      // nodo esté adjunto, que es lo que hace que esto no sea una carrera.
      expect(await p.leerTexto(celda(1, 1))).toBe(CODIGO_OK);
      expect(await p.leerTexto(celda(1, 2))).toBe(PLAZA);
      expect(await p.leerTexto(celda(1, 3))).toBe('2026-08-01');
      expect(await p.leerTexto(celda(1, 4))).toBe(COSTO_PORTAL);

      // La fila 2 no existe: `null` es lo que hace que `buscarFila()` pare.
      expect(await p.leerTexto(celda(2, 1))).toBeNull();
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('captura', () => {
  it('devuelve un data-uri de JPEG que se puede decodificar', async () => {
    const p = await abrirEnPortal();
    try {
      await p.escribir('#rfc', 'GMX0902279I1');
      const c = await p.captura();
      expect(c.startsWith('data:image/jpeg;base64,')).toBe(true);
      const bytes = Buffer.from(c.slice('data:image/jpeg;base64,'.length), 'base64');
      // Magia de JPEG. Sin esto, "es una cadena larga" pasaría por captura.
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
      expect(bytes.length).toBeGreaterThan(1_000);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('con `directorioCapturas` escribe el archivo y devuelve la RUTA', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'likida-captura-'));
    const p = await abrirEnPortal({ directorioCapturas: dir });
    try {
      const ruta = await p.captura();
      expect(ruta.startsWith(dir)).toBe(true);
      expect(ruta.endsWith('.jpg')).toBe(true);
      const bytes = await readFile(ruta);
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xff, 0xd8, 0xff]);
    } finally {
      await p.cerrar();
      await rm(dir, { recursive: true, force: true });
    }
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('el presupuesto de tiempo', () => {
  it('un portal que acepta la conexión y calla CORTA, no cuelga', async () => {
    const p = await nuevaPagina({ topes: { navegar: 800 } });
    try {
      const t0 = Date.now();
      await expect(p.abrir(portal.url('/nunca'))).rejects.toThrow();
      const ms = Date.now() - t0;
      // Sin tope, el default de undici/Chromium deja esto colgado hasta que
      // Vercel mate la función: el peor final posible, porque no deja rastro.
      expect(ms).toBeLessThan(4_000);
      expect(ms).toBeGreaterThanOrEqual(700);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);

  it('un 404 del portal se dice como 404, no como "el selector no existe"', async () => {
    const pagina = await nuevaPagina();
    try {
      await expect(pagina.abrir(portal.url('/ruta-que-no-existe'))).rejects.toThrow(/404/);
    } finally {
      await pagina.cerrar();
    }
  }, HOLGURA);

  it('la red de seguridad corta aunque Playwright no devuelva nunca', async () => {
    // El `timeout` de Playwright solo cubre lo que Playwright controla. Esta es
    // la segunda capa —la misma idea que `acotada()` en `presupuesto.ts`— y para
    // probarla hace falta una `Page` que no devuelva jamás.
    const paginaMuerta = { goto: () => new Promise(() => {}) } as unknown as Page;
    const p = new PaginaPlaywright(paginaMuerta, { topes: { navegar: 300 } });
    const t0 = Date.now();
    await expect(p.abrir('http://127.0.0.1:1/nada')).rejects.toThrow(/tope de navegar/);
    // 300 de tope + 1500 de gracia.
    expect(Date.now() - t0).toBeLessThan(3_000);
  }, HOLGURA);

  it('leerTexto agotado devuelve null en vez de lanzar (lo dice el contrato)', async () => {
    const p = await abrirEnPortal({ topes: { lectura: 400 } });
    try {
      const t0 = Date.now();
      expect(await p.leerTexto('#tampoco-existe')).toBeNull();
      expect(Date.now() - t0).toBeLessThan(2_500);
    } finally {
      await p.cerrar();
    }
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('un navegador por LOTE, no por ticket', () => {
  it('dos pestañas del mismo lote comparten UN Chromium', async () => {
    let arranques = 0;
    const s = await SesionNavegador.abrir({
      lanzar: (o) => {
        arranques += 1;
        return chromium.launch(o);
      },
    });
    try {
      const fabrica = s.fabrica();
      const a = await fabrica();
      const b = await fabrica();
      await a.abrir(portal.url());
      await b.abrir(portal.url());
      // Lo que se ahorra no es tanto el arranque (69 ms medidos en esta Mac)
      // como la SESIÓN: navegar, llenar los seis datos fiscales y esperar los
      // dos catálogos por AJAX, que es ~1.2 s y se paga una vez por lote.
      expect(arranques).toBe(1);
      expect(s.paginasVivas).toBe(2);

      // Y cerrar UNA pestaña —lo que hace la base en el `finally` de cada
      // ticket— NO puede cerrar el navegador: si lo hiciera, el segundo ticket
      // del lote pagaría otro arranque y la decisión de costo se perdería.
      await a.cerrar();
      expect(s.conectado).toBe(true);
      expect(s.paginasVivas).toBe(1);
    } finally {
      await s.cerrar();
      expect(s.conectado).toBe(false);
    }
  }, HOLGURA);

  it('conNavegador cierra el navegador AUNQUE el trabajo lance', async () => {
    let capturada: SesionNavegador | undefined;
    await expect(
      conNavegador(async (abrirPagina, s) => {
        capturada = s;
        const p = await abrirPagina();
        await p.abrir(portal.url());
        // Un selector movido, un CAPTCHA, un tope agotado: todo llega aquí.
        throw new Error('reventó a media sesión');
      }),
    ).rejects.toThrow('reventó a media sesión');

    expect(capturada).toBeDefined();
    // Sin el `finally`, cada corrida del cron dejaría un Chromium vivo.
    expect(capturada!.conectado).toBe(false);
    expect(capturada!.paginasVivas).toBe(0);
  }, HOLGURA);

  it('la fábrica se niega a abrir pestañas después de cerrar la sesión', async () => {
    const s = await SesionNavegador.abrir();
    const fabrica = s.fabrica();
    await s.cerrar();
    await expect(fabrica()).rejects.toThrow(/ya se cerró/);
  }, HOLGURA);

  it('arranca headless y con las banderas de contenedor', async () => {
    const vistas: Array<Record<string, unknown>> = [];
    const s = await SesionNavegador.abrir({
      lanzar: (o) => {
        vistas.push(o as Record<string, unknown>);
        return chromium.launch(o);
      },
    });
    try {
      const o = vistas[0];
      expect(o.headless).toBe(true);
      expect(o.chromiumSandbox).toBe(false);
      const args = o.args as string[];
      // La que mata un Chromium en un contenedor sin decir por qué.
      expect(args).toContain('--disable-dev-shm-usage');
      expect(args).toContain('--no-sandbox');
      expect(args).toContain('--disable-renderer-backgrounding');
      expect(BANDERAS_CONTENEDOR).toContain('--disable-dev-shm-usage');
    } finally {
      await s.cerrar();
    }
  }, HOLGURA);

  it('cerrar() dos veces no lanza', async () => {
    const s = await SesionNavegador.abrir();
    await s.cerrar();
    await expect(s.cerrar()).resolves.toBeUndefined();
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
// EL ADAPTADOR DE CAPUFE, ENTERO, CONTRA EL PORTAL DE PRUEBA
// ═══════════════════════════════════════════════════════════════════════════

const RECEPTOR: DatosReceptorCapufe = {
  rfc: 'GMX0902279I1',
  nombre: 'TRANSPORTES DEL BAJIO SA DE CV',
  codigoPostal: '37000',
  regimenFiscal: '601',
  usoCfdi: 'G03',
  correo: 'facturas@transportesdelbajio.mx',
};

/**
 * La misma página, pero abriendo el portal LOCAL.
 *
 * `AdaptadorCapufe.portal` es la URL real y no se toca —cambiarla en la prueba
 * sería probar otra cosa—, así que la redirección se hace donde corresponde: en
 * la fábrica de páginas, que es el punto de inyección que la base ya define.
 *
 * De paso guarda lo que hizo falta mirar ANTES de que la página se cierre.
 */
class PaginaEnLocal implements PaginaCapufe {
  estadoCb1: string | null = null;
  eventos: string | null = null;
  clics: string[] = [];

  constructor(private readonly real: PaginaPlaywright, private readonly url: string) {}

  async abrir(): Promise<void> {
    await this.real.abrir(this.url);
  }
  escribir(s: string, v: string) { return this.real.escribir(s, v); }
  hacerClic(s: string) { this.clics.push(s); return this.real.hacerClic(s); }
  leerTexto(s: string) { return this.real.leerTexto(s); }
  captura() { return this.real.captura(); }
  existe(s: string) { return this.real.existe(s); }
  seleccionar(s: string, v: string) { return this.real.seleccionar(s, v); }
  opciones(s: string) { return this.real.opciones(s); }
  valorSeleccionado(s: string) { return this.real.valorSeleccionado(s); }

  async cerrar(): Promise<void> {
    try {
      this.estadoCb1 = await this.real.leerTexto('#estadoCb1');
      this.eventos = await this.real.leerTexto('#eventos');
    } catch {
      // Mirar antes de cerrar es diagnóstico de la prueba, no parte del contrato.
    }
    await this.real.cerrar();
  }
}

describe('CAPUFE de punta a punta, con navegador de verdad', () => {
  let ultima: PaginaEnLocal | undefined;

  function adaptador(extra: Partial<ConstructorParameters<typeof AdaptadorCapufe>[0]> = {}) {
    return new AdaptadorCapufe({
      receptor: RECEPTOR,
      abrirPagina: async () => {
        const p = await sesion.fabrica()();
        ultima = new PaginaEnLocal(p, portal.url());
        return ultima;
      },
      intervaloMs: 150,
      esperaMaxMs: 8_000,
      ...extra,
    });
  }

  it('ENSAYO: llena los datos fiscales, agrega el código bueno, anota el rechazado y NO aprieta emitir', async () => {
    const t0 = Date.now();
    const r = await adaptador().facturarVarios(
      [
        { codigo: CODIGO_OK, montoEsperado: 123.45, gastoId: 'g-1' },
        { codigo: CODIGO_RECHAZADO, montoEsperado: 50, gastoId: 'g-2' },
      ],
      'ensayo',
    );
    const ms = Date.now() - t0;
    // Para el reporte: cuánto cuesta una sesión completa contra el portal local.
    console.log(`[medido] sesión de ensayo con 2 códigos: ${ms} ms`);

    expect(r.ok).toBe(true);
    expect(r.modo).toBe('ensayo');
    expect(r.cfdiUuid).toBeUndefined();
    expect(r.requiereCaptcha).toBe(false);

    // Los datos fiscales quedaron escritos, incluidos los dos desplegables que
    // llegan por AJAX.
    expect(r.capturado).toMatchObject({
      rfc: 'GMX0902279I1',
      nombre: RECEPTOR.nombre,
      codigoPostal: '37000',
      correo: RECEPTOR.correo,
      regimenFiscal: '601',
      usoCfdi: 'G03',
    });

    const bueno = r.codigos.find((c) => c.codigo === CODIGO_OK)!;
    expect(bueno.estado).toBe('agregado');
    expect(bueno.plaza).toBe(PLAZA);
    expect(bueno.fecha).toBe('2026-08-01');
    expect(bueno.costoPortal).toBe(123.45);
    expect(bueno.discrepanciaDeMonto).toBeFalsy();

    const malo = r.codigos.find((c) => c.codigo === CODIGO_RECHAZADO)!;
    expect(malo.estado).toBe('rechazado');
    expect(malo.motivo).toContain(RECHAZO_DEL_PORTAL);

    expect(r.totalPortal).toBe(123.45);
    expect(r.captura?.startsWith('data:image/jpeg;base64,')).toBe(true);

    // El botón de emitir NUNCA se tocó, y el checkbox de partidos políticos
    // tampoco: eso no es teoría, es el DOM leído antes de cerrar la pestaña.
    expect(ultima!.clics).not.toContain('button:has-text("Facturar")');
    expect(ultima!.clics).not.toContain('#cb1');
    expect(ultima!.estadoCb1).toBe('sin marcar');
    // Y los eventos que el portal necesitaba, disparados de verdad.
    expect(ultima!.eventos).toContain('rfc:change');
    expect(ultima!.eventos).toContain('reg:change');
  }, HOLGURA);

  it('EMITIR contra el portal de prueba: aprieta, espera el UUID y lo devuelve', async () => {
    // Contra el portal DE PRUEBA. Nunca contra CAPUFE: ahí este mismo camino
    // crea un CFDI ante el SAT que no se deshace.
    const t0 = Date.now();
    const r = await adaptador().facturarVarios([{ codigo: CODIGO_OK, montoEsperado: 123.45 }], 'emitir');
    console.log(`[medido] sesión de emisión con 1 código: ${Date.now() - t0} ms`);

    expect(r.ok).toBe(true);
    expect(r.modo).toBe('emitir');
    expect(r.cfdiUuid).toBe(UUID_FALSO);
    expect(ultima!.clics).toContain('button:has-text("Facturar")');
    expect(ultima!.estadoCb1).toBe('sin marcar');
  }, HOLGURA);

  it('NO emite cuando el costo del portal no cuadra con el del ticket', async () => {
    const r = await adaptador().facturarVarios([{ codigo: CODIGO_OK, montoEsperado: 999 }], 'emitir');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('NO SE EMITIÓ');
    expect(r.discrepancias).toHaveLength(1);
    expect(ultima!.clics).not.toContain('button:has-text("Facturar")');
  }, HOLGURA);

  it('un selector que el portal ya no tiene se reporta en el pre-vuelo, sin escribir nada', async () => {
    const r = await adaptador({ selectores: { rfc: '#rfc-que-cambiaron' } }).facturarVarios(
      [{ codigo: CODIGO_OK }],
      'ensayo',
    );
    expect(r.ok).toBe(false);
    expect(r.error).toContain('#rfc-que-cambiaron');
    expect(r.capturado).toEqual({});
  }, HOLGURA);
});

// ═══════════════════════════════════════════════════════════════════════════
describe('los contratos de tipo', () => {
  it('PaginaPlaywright satisface PaginaPortal y PaginaCapufe', () => {
    // No se importa `PaginaCapufe` en la implementación a propósito —haría que
    // la página genérica dependiera de un adaptador concreto—, así que la
    // compatibilidad se ata aquí: si una firma se separa, esto no compila.
    const comoPortal: (p: PaginaPlaywright) => PaginaPortal = (p) => p;
    const comoCapufe: (p: PaginaPlaywright) => PaginaCapufe = (p) => p;
    expect(typeof comoPortal).toBe('function');
    expect(typeof comoCapufe).toBe('function');
  });
});
