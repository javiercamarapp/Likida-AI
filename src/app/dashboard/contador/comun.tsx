import { AlertTriangle } from 'lucide-react';
import type { OpcionesFiscales } from '@/lib/cuadra/fiscal';
import type { CuadraConfig } from '@/lib/cuadra/config';
import { LecturaIncompleta } from '@/lib/cuadra/pg';

/**
 * Piezas compartidas por las seis pantallas del panel fiscal.
 *
 * `safe` es el mismo patrón que ya usan `dashboard/page.tsx` y
 * `combustible-casetas/page.tsx`: una consulta que falla devuelve `null`, y la
 * pantalla pinta "no se pudo cargar" en vez de un cero. La diferencia entre un
 * cero y un fallo es TODO el producto: `pg.ts` traduce el error por valor de
 * supabase-js a una excepción justamente para que este `catch` la vea.
 *
 * ── LO QUE SE LE AÑADIÓ, Y POR QUÉ NO BASTABA CON `null` ──────────────────
 *
 * `traerTodo` ahora LANZA `LecturaIncompleta` cuando no puede demostrar que
 * trajo todas las filas, en vez de devolver una cifra corta en silencio. Eso ya
 * protege al contador de la peor falla —una suma a la baja, que es la dirección
 * que nadie revisa—, pero deja las dos causas indistinguibles en pantalla: "la
 * base no responde" y "la base respondió a medias" piden cosas distintas. La
 * primera es esperar; la segunda es que alguien mire el `max_rows` del proyecto
 * antes de que el contador declare con este panel.
 *
 * Por eso el motivo se acumula en una lista que la página pasa, en vez de
 * cambiar el tipo de retorno: las quince lecturas de `gastos` en el JSX siguen
 * siendo `T | null`, y solo la rama de error gana precisión.
 */
export interface Fallo {
  /** Qué se estaba leyendo, en palabras del contador. */
  que: string;
  /** `true` = la lectura quedó a medias. `false` = no se pudo leer nada. */
  incompleta: boolean;
  detalle: string;
}

export async function safe<T>(fn: () => Promise<T>, registro?: { que: string; en: Fallo[] }): Promise<T | null> {
  try {
    return await fn();
  } catch (e) {
    if (registro) {
      registro.en.push({
        que: registro.que,
        incompleta: e instanceof LecturaIncompleta,
        detalle: e instanceof Error ? e.message : String(e),
      });
    }
    return null;
  }
}

/**
 * El bloque de error de las pantallas fiscales.
 *
 * Distingue los dos casos con todas sus letras y NUNCA enseña una cifra al
 * lado. Un panel fiscal que pinta un total junto a un aviso de "lectura
 * parcial" invita a copiar el total: el aviso se lee, la cifra se usa.
 *
 * El `detalle` técnico se pinta en pequeño y sin nombres de columna crudos
 * hacia el usuario final — el mensaje de `LecturaIncompleta` dice "se leyeron N
 * de M filas", que es información que el contralor SÍ puede repetir por
 * teléfono, no el esquema de la base.
 */
export function AvisoDeFallo({ fallos }: { fallos: Fallo[] }) {
  if (!fallos.length) return null;
  const hayIncompleta = fallos.some((f) => f.incompleta);
  return (
    <div className="glass-panel p-5">
      <div className="flex items-start gap-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0" style={{ background: 'var(--badbg)' }}>
          <AlertTriangle width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">
            {hayIncompleta
              ? 'La lectura quedó incompleta — no se enseña ninguna cifra'
              : 'No se pudo leer el dato de esta pantalla'}
          </p>
          <p className="text-sm mt-1.5" style={{ color: 'var(--muted)' }}>
            {hayIncompleta ? (
              <>
                La base respondió, pero no con todas las filas. Media tabla sumada se ve exactamente igual que la
                tabla entera, solo que más baja — y a la baja es la dirección que nadie revisa. Antes de declarar con
                este panel, que alguien revise el <code className="text-xs">max_rows</code> del proyecto en Supabase.
              </>
            ) : (
              <>
                Ninguna cifra se pinta sin el dato: un cero aquí se leería como una medición. Vuelve a cargar en un
                momento; si sigue igual, la base no está respondiendo.
              </>
            )}
          </p>
          <ul className="mt-2 space-y-0.5">
            {fallos.map((f, i) => (
              <li key={i} className="text-xs" style={{ color: 'var(--faint)' }}>
                {f.que}: {f.detalle}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/** Los query params que NO son `?p=` y tienen que sobrevivir a cada clic. */
export type ParamsPanel = { vista?: string; tenant?: string; rol?: string; p?: string };

export function extraDe(sp: ParamsPanel | undefined): Record<string, string> {
  const e: Record<string, string> = {};
  if (sp?.tenant) e.tenant = sp.tenant;
  if (sp?.vista) e.vista = sp.vista;
  if (sp?.rol) e.rol = sp.rol;
  return e;
}

/**
 * Los topes y claves fiscales salen de la config del TENANT, no de constantes
 * de este archivo.
 *
 * Una flota puede tener su propio tope de efectivo o su propio catálogo de
 * claves de combustible (`tenant.config`, vía `getConfig`). Copiar el 2000 de
 * LISR 27-III aquí haría que el panel del contador y el motor del cuadre
 * juzgaran el MISMO comprobante con reglas distintas, y el contador lo
 * descubriría comparando esta pantalla contra su PDF.
 */
export function opcionesDe(cfg: CuadraConfig): OpcionesFiscales {
  const f15 = cfg.facilidadCombustibleEfectivo;
  return {
    efectivoTopeMxn: cfg.estimulos.efectivoTopeMxn,
    clavesCombustible: cfg.hidrocarburos.claves,
    clavesDieselIeps: cfg.estimulos.clavesDieselIeps,
    // AUDITORÍA 14, ALTO: el panel ofrecía el 15% a flotas no elegibles. La
    // declaración de la flota (al registrarse) llega hasta aquí.
    elegible15: (f15 && f15.dedicacionExclusivaCarga !== undefined && f15.regimenElegible !== undefined)
      ? (f15.dedicacionExclusivaCarga === true && f15.regimenElegible === true)
      : undefined,
  };
}

/**
 * Catálogo c_FormaPago del SAT, solo las claves que el intake produce hoy
 * (`intake/ocr.ts` mapea a '01'/'04'; el XML puede traer cualquiera).
 *
 * Una clave desconocida se imprime TAL CUAL en vez de traducirse a "Otro": el
 * contador reconoce el código del catálogo, y "Otro" le esconde justo el dato
 * que necesita para clasificar la póliza.
 */
const FORMAS_PAGO: Record<string, string> = {
  '01': 'Efectivo',
  '02': 'Cheque nominativo',
  '03': 'Transferencia',
  '04': 'Tarjeta de crédito',
  '28': 'Tarjeta de débito',
  '29': 'Tarjeta de servicios',
  '30': 'Aplicación de anticipos',
  '99': 'Por definir',
};

export function etiquetaFormaPago(codigo: string | null): string {
  if (!codigo) return 'Sin dato';
  return FORMAS_PAGO[codigo] ? `${FORMAS_PAGO[codigo]} (${codigo})` : codigo;
}

/**
 * El renglón fijo que va al pie de cada pantalla del panel.
 *
 * Dice dos cosas que el contador tiene derecho a saber antes de usar una cifra:
 * de dónde sale el dato (los comprobantes que los operadores mandan por
 * WhatsApp, no su contabilidad completa) y que esto no sustituye su papel de
 * trabajo. Sin ese marco, un total de IVA de esta pantalla se lee como si
 * fuera TODO el IVA acreditable del mes, y no lo es.
 */
export function PieDeAlcance({ children }: { children?: React.ReactNode }) {
  return (
    <p className="text-xs leading-relaxed" style={{ color: 'var(--faint)' }}>
      Todo lo de esta pantalla sale de los comprobantes que los operadores mandaron por WhatsApp y que el
      agente leyó. No es la contabilidad completa de la flota: los gastos que no pasan por el teléfono
      (nómina, seguros, arrendamiento, refacciones de taller) no están aquí y hay que sumarlos aparte.
      {children ? <> {children}</> : null}
    </p>
  );
}

/**
 * Un dato que no se puede afirmar. NO es un cero.
 *
 * Existe como componente y no como un `—` suelto para que sea imposible que
 * una celda "sin dato" se confunda con una celda "cero" al leer la tabla en
 * diagonal, que es como se leen las tablas.
 */
export function SinDato({ titulo }: { titulo?: string }) {
  return <span style={{ color: 'var(--faint)' }} title={titulo ?? 'No se capturó este dato'}>—</span>;
}
