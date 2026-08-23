import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { Writable } from 'node:stream';
import type { ReactElement } from 'react';
import { renderToPipeableStream, renderToStaticMarkup } from 'react-dom/server';
import { Bloque, EsqCifras, EsqTabla, vigilar } from './bloque';
import { LimiteError } from './limite-error';

// `EstadoError` (el fallback de `LimiteError`) usa `router.refresh()` para
// reintentar, y `useRouter` fuera del App Router revienta. Se le da un router
// de mentiras: lo que esta prueba mira es QUÉ se pinta cuando un bloque
// revienta, no a dónde navega el botón.
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {} }) }));

// ═══════════════════════════════════════════════════════════════════════════
// FE-14 — LA PANTALLA SE PINTA POR PARTES.
//
// Lo que estas pruebas defienden no es un componente, es una PROMESA al
// usuario: que lo barato aparezca de inmediato aunque lo caro tarde, y que
// una tarjeta rota no se lleve a sus hermanas por delante. Las dos se
// verifican sobre el stream REAL de React (`renderToPipeableStream`), que es
// el mismo mecanismo que usa Next: `renderToStaticMarkup` no sirve aquí
// porque espera a que todo resuelva, que es justo lo que veníamos a evitar.
// ═══════════════════════════════════════════════════════════════════════════

/** El HTML del PRIMER FLUSH: lo que el navegador recibe antes de que ninguna
 *  consulta lenta conteste. Se corta el stream a propósito tras la cáscara. */
async function cascara(elemento: ReactElement): Promise<string> {
  const trozos: string[] = [];
  const salida = new Writable({
    write(trozo, _enc, cb) { trozos.push(String(trozo)); cb(); },
  });
  await new Promise<void>((listo, falla) => {
    const { pipe } = renderToPipeableStream(elemento, {
      onShellReady() { pipe(salida); listo(); },
      onShellError(e) { falla(e as Error); },
      // Un bloque que revienta se reporta por aquí; la prueba que lo provoca
      // lo espera, así que no se convierte en fallo del render.
      onError() {},
    });
  });
  // Un turno del bucle de eventos para que lo ya escrito llegue al Writable.
  await new Promise((r) => setImmediate(r));
  return trozos.join('');
}

/** El HTML COMPLETO, cuando todos los bloques ya aterrizaron. */
async function completo(elemento: ReactElement): Promise<string> {
  const trozos: string[] = [];
  const salida = new Writable({
    write(trozo, _enc, cb) { trozos.push(String(trozo)); cb(); },
  });
  await new Promise<void>((listo, falla) => {
    const { pipe } = renderToPipeableStream(elemento, {
      onShellReady() { pipe(salida); },
      onShellError(e) { falla(e as Error); },
      onError() {},
      onAllReady() { listo(); },
    });
  });
  await new Promise((r) => setImmediate(r));
  return trozos.join('');
}

/** Una consulta que NUNCA contesta — la lenta de la pantalla. */
function jamas<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

async function Lenta({ p }: { p: Promise<string> }) {
  return <p>{await p}</p>;
}

async function Revienta({ p }: { p: Promise<string> }) {
  return <p>{await p}</p>;
}

describe('FE-14 — lo barato se pinta sin esperar a lo caro', () => {
  it('manda la cáscara y el esqueleto aunque la consulta lenta siga en vuelo', async () => {
    const html = await cascara(
      <div>
        <h1>Resumen</h1>
        <Bloque mensaje="No se pudo cargar." esqueleto={<EsqTabla filas={3} />}>
          <Lenta p={jamas<string>()} />
        </Bloque>
      </div>,
    );
    // Lo barato: ya está en el primer byte útil.
    expect(html).toContain('Resumen');
    // Y el hueco de lo caro está reservado, con su shimmer y su rótulo de
    // carga para el lector de pantalla.
    expect(html).toContain('skeleton');
    expect(html).toContain('aria-label="Cargando"');
  });

  it('un bloque lento NO retiene al bloque rápido de al lado', async () => {
    const html = await cascara(
      <div>
        <Bloque mensaje="a" esqueleto={<EsqTabla filas={2} />}>
          <Lenta p={jamas<string>()} />
        </Bloque>
        <Bloque mensaje="b" esqueleto={<EsqTabla filas={2} />}>
          <Lenta p={Promise.resolve('la cifra rápida')} />
        </Bloque>
      </div>,
    );
    // El hermano rápido ya aterrizó; el lento sigue en su esqueleto. Esto es
    // literalmente lo que el Promise.all impedía: antes, el HTML no existía
    // hasta que la MÁS LENTA terminara.
    expect(html).toContain('la cifra rápida');
    expect(html).toContain('skeleton');
  });

  it('sin boundary, el mismo árbol no manda NADA hasta que la lenta conteste', async () => {
    // La contraprueba, para que la de arriba no sea un espejismo: el mismo
    // contenido barato colgado detrás de un `await` que no resuelve.
    async function PaginaVieja({ p }: { p: Promise<string> }) {
      const dato = await p;
      return <div><h1>Resumen</h1><p>{dato}</p></div>;
    }
    let llego = false;
    const carrera = cascara(<PaginaVieja p={jamas<string>()} />).then(() => { llego = true; });
    await Promise.race([carrera, new Promise((r) => setTimeout(r, 50))]);
    expect(llego).toBe(false);
  });
});

describe('FE-14 — un bloque que revienta no tumba a sus hermanos', () => {
  it('el fallo se queda DENTRO de su boundary: la cáscara y la hermana siguen en pie', async () => {
    const html = await completo(
      <div>
        <h1>Resumen</h1>
        <Bloque mensaje="No se pudo leer el motor fiscal." esqueleto={null}>
          <Revienta p={Promise.reject(new Error('la base se cayó'))} />
        </Bloque>
        <Bloque mensaje="b" esqueleto={null}>
          <Lenta p={Promise.resolve('la tarjeta hermana')} />
        </Bloque>
      </div>,
    );
    // ESTO es lo que la pantalla entera se jugaba: antes, una consulta que
    // lanzaba subía hasta el `error.tsx` de la ruta y se llevaba todo. Ahora
    // el fallo se queda en su boundary — el resto del árbol ya se envió.
    expect(html).toContain('Resumen');
    expect(html).toContain('la tarjeta hermana');
    // React marca ESE boundary (y solo ese) para que el cliente lo rehaga:
    // ahí lo recoge `LimiteError` y pinta su tarjeta de error (ver la prueba
    // de abajo, que lo verifica en el servidor con un fallo síncrono).
    expect(html).toContain('$RX("B:0"');
    expect(html).not.toContain('$RX("B:1"');
  });

  it('`LimiteError` pinta la tarjeta de error de ESE bloque, con su botón de reintento', () => {
    // Se mira la clase por dentro, y no un render de servidor, porque
    // `react-dom/server` NUNCA invoca límites de error: en streaming, el
    // boundary que revienta se marca para que el CLIENTE lo rehaga, y es ahí
    // —ya en el navegador— donde `LimiteError` atrapa. Lo que aquí se fija es
    // qué pinta cuando le toca.
    expect(LimiteError.getDerivedStateFromError()).toEqual({ rompio: true });

    const limite = new LimiteError({ mensaje: 'No se pudo leer el motor fiscal.', children: null });
    limite.state = { rompio: true };
    const html = renderToStaticMarkup(limite.render() as ReactElement);
    // El mensaje con las palabras de ESE bloque, no un error genérico de
    // página — el manejo de error por bloque que ya existía (`EstadoError`)
    // se conserva entero, botón de reintento incluido.
    expect(html).toContain('No se pudo leer el motor fiscal.');
    expect(html).toContain('Reintentar');

    // Y mientras no haya reventado, deja pasar a sus hijos intactos.
    const sano = new LimiteError({ mensaje: 'x', children: <p>la tarjeta</p> });
    expect(renderToStaticMarkup(sano.render() as ReactElement)).toContain('la tarjeta');
  });
});

describe('FE-14 — las consultas se lanzan en paralelo, no en cadena', () => {
  it('todas arrancan antes de que ninguna se espere', async () => {
    const arranques: string[] = [];
    const consulta = (nombre: string, ms: number) => {
      arranques.push(nombre);
      return new Promise<string>((r) => setTimeout(() => r(nombre), ms));
    };
    // El patrón de las páginas: lanzar arriba, esperar adentro.
    const pLenta = consulta('lenta', 30);
    const pRapida = consulta('rapida', 0);
    // En el MISMO tick ya salieron las dos. Si el patrón se hubiera revertido
    // a `await` en el padre, aquí solo estaría la primera.
    expect(arranques).toEqual(['lenta', 'rapida']);

    const html = await completo(
      <div>
        <Bloque mensaje="a" esqueleto={null}><Lenta p={pLenta} /></Bloque>
        <Bloque mensaje="b" esqueleto={null}><Lenta p={pRapida} /></Bloque>
      </div>,
    );
    expect(html).toContain('lenta');
    expect(html).toContain('rapida');
  });

  it('`vigilar` adjunta un oyente sin tragarse el error', async () => {
    // El rechazo tiene que seguir llegando a quien lo espere — lo único que
    // `vigilar` evita es el `unhandledRejection` del hueco entre lanzar y
    // esperar.
    const p = vigilar(Promise.reject(new Error('caída')));
    await expect(p).rejects.toThrow('caída');
  });

  it('no deja un unhandledRejection en el hueco entre lanzar y esperar', async () => {
    const sueltas: unknown[] = [];
    const oyente = (e: unknown) => sueltas.push(e);
    process.on('unhandledRejection', oyente);
    try {
      vigilar(Promise.reject(new Error('caída')));
      // Varios turnos: Node reporta el rechazo huérfano al final del tick.
      await new Promise((r) => setTimeout(r, 20));
      expect(sueltas).toHaveLength(0);
    } finally {
      process.off('unhandledRejection', oyente);
    }
  });
});

describe('FE-14 — el esqueleto no provoca salto de layout', () => {
  it('usa LAS MISMAS clases de rejilla que el contenido definitivo', () => {
    // La rejilla se pasa como parámetro justo para esto: si el esqueleto
    // ocupara 1 columna donde el contenido ocupa 4, el aterrizaje movería
    // media pantalla.
    const rejilla = 'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-2';
    const html = renderToStaticMarkup(<EsqCifras n={4} rejilla={rejilla} />);
    expect(html).toContain(rejilla);
    // Y cuatro huecos, uno por tarjeta.
    expect(html.split('rounded-xl').length - 1).toBe(4);
  });

  it('reserva alto real, no una tira de 14px', () => {
    const html = renderToStaticMarkup(<EsqCifras n={3} />);
    expect(html).toContain('min-height:100px');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LA RED CONTRA EL REVERTIDO SILENCIOSO.
//
// FE-14 es una propiedad de las PÁGINAS, no de este módulo: alguien puede
// dejar `bloque.tsx` intacto y volver a meter un Promise.all gigante en el
// Resumen sin que ninguna prueba de arriba se entere. Esto mira las cuatro
// pantallas que se migraron y exige que sigan partidas.
// ═══════════════════════════════════════════════════════════════════════════
const PANTALLAS: Array<{ nombre: string; archivo: string; minimo: number }> = [
  { nombre: 'Resumen del dueño', archivo: 'src/app/dashboard/inicio-contenido.tsx', minimo: 6 },
  { nombre: 'Inicio de operación', archivo: 'src/app/dashboard/inicio-operacion.tsx', minimo: 6 },
  { nombre: 'Panel del contador', archivo: 'src/app/dashboard/contador/inicio-contador.tsx', minimo: 4 },
  { nombre: 'Agente de Liquidación', archivo: 'src/app/dashboard/agentes/liquidacion/vista.tsx', minimo: 6 },
];

describe('FE-14 — las pantallas pesadas siguen partidas en boundaries', () => {
  for (const { nombre, archivo, minimo } of PANTALLAS) {
    it(`${nombre} monta al menos ${minimo} <Bloque>`, () => {
      const fuente = readFileSync(archivo, 'utf8');
      const n = fuente.split('<Bloque').length - 1;
      expect(n, `${archivo} bajó a ${n} boundaries`).toBeGreaterThanOrEqual(minimo);
    });
  }
});
