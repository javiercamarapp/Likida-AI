'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';
import {
  validarAjustes, FORMATOS, type AjustesCrudos,
} from '@/lib/likida/ajustes_operativos';
// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta. Una cifra que se lee
// distinto en dos pantallas se lee como dos cálculos. (Este archivo hizo fallar
// esa prueba en su primera versión: el guardia sirve.)
import { mxn, numero, litros } from '@/lib/formato';

export type ResultadoGuardar = { ok: true } | { ok: false; error: string } | null;
export type AccionGuardar = (previo: ResultadoGuardar, fd: FormData) => Promise<ResultadoGuardar>;

const CAMPO = 'w-full text-[13px] px-3 py-1.5 rounded-lg hairline cifra-mono';
const ETIQUETA = 'etiqueta-mono text-[10px] uppercase block mb-1';

function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="text-[13px] px-4 py-2.5 rounded-lg font-medium inline-flex items-center gap-2 transition-opacity hover:opacity-85 disabled:opacity-50"
      style={{ background: 'var(--marca)', color: 'white' }}>
      <Save width={14} height={14} strokeWidth={1.75} />
      {pending ? 'Guardando…' : 'Guardar ajustes'}
    </button>
  );
}

/**
 * Los ajustes operativos de la flota, EDITABLES.
 *
 * La vista previa de la derecha corre `validarAjustes` —el mismo módulo puro
 * que corre el servidor— sobre lo que está tecleado, y con el resultado
 * calcula el diésel esperado de un viaje de ejemplo. No es decoración: el
 * tabulador es aritmética abstracta hasta que ves que subir el rendimiento de
 * 3.0 a 3.5 le quita $1,200 de diésel esperado a un viaje de 900 km, y que ese
 * dinero es exactamente lo que le vas a ir a reclamar a un chofer.
 *
 * El guardado RE-VALIDA en el servidor. Lo de aquí solo alimenta la vista
 * previa y los avisos tempranos — nunca es la autoridad.
 */
export function FormaAjustes({ inicial, ejemploKm, guardar }: {
  inicial: AjustesCrudos;
  /** Los km de un viaje REAL de la flota, para que la vista previa hable de
   *  su operación y no de un viaje inventado. null = todavía no hay viajes
   *  con km capturados, y entonces se dice, no se rellena con un número. */
  ejemploKm: number | null;
  guardar: AccionGuardar;
}) {
  const [estado, accion] = useActionState(guardar, null);
  const [v, setV] = useState<AjustesCrudos>(inicial);

  const set = (k: keyof AjustesCrudos) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const revision = useMemo(() => {
    try {
      return { ok: true as const, valor: validarAjustes(v) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Algo no cuadra.' };
    }
  }, [v]);

  // El mismo cálculo que hace el motor para el diésel esperado de un tramo.
  const previo = useMemo(() => {
    if (!revision.ok || ejemploKm === null) return null;
    const t = revision.valor.tabulador;
    const litros = ejemploKm / (t.rendimientoPorDefecto * t.factorCarga);
    return {
      litros,
      pesos: litros * t.precioDieselPorDefecto,
      margen: t.umbralDesviacion * 100,
    };
  }, [revision, ejemploKm]);

  return (
    <div className="grid lg:grid-cols-2 gap-5">
      <form action={accion} className="space-y-4">
        <input type="hidden" name="salida" value={v.salida} />

        <fieldset className="space-y-3">
          <legend className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
            Tabulador — con esto el motor calcula el diésel esperado
          </legend>

          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="aj-rend" className={ETIQUETA} style={{ color: 'var(--faint)' }}>Rendimiento (km/L)</label>
              <input id="aj-rend" name="rendimientoPorDefecto" value={v.rendimientoPorDefecto}
                onChange={set('rendimientoPorDefecto')} className={CAMPO} style={{ background: 'var(--surface)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                El de una unidad sin catálogo propio. Un tractocamión full anda entre 2 y 3.5.
              </p>
            </div>

            <div>
              <label htmlFor="aj-factor" className={ETIQUETA} style={{ color: 'var(--faint)' }}>Factor de carga</label>
              <input id="aj-factor" name="factorCarga" value={v.factorCarga}
                onChange={set('factorCarga')} className={CAMPO} style={{ background: 'var(--surface)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                Cuánto rinde cargado contra vacío (0.78 = rinde 78%). Siempre menor o igual a 1.
              </p>
            </div>

            <div>
              <label htmlFor="aj-diesel" className={ETIQUETA} style={{ color: 'var(--faint)' }}>Precio del diésel (MXN/L)</label>
              <input id="aj-diesel" name="precioDieselPorDefecto" value={v.precioDieselPorDefecto}
                onChange={set('precioDieselPorDefecto')} className={CAMPO} style={{ background: 'var(--surface)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                Se usa cuando el ticket no trae precio por litro.
              </p>
            </div>

            <div>
              <label htmlFor="aj-umbral" className={ETIQUETA} style={{ color: 'var(--faint)' }}>Umbral de desviación (%)</label>
              <input id="aj-umbral" name="umbralDesviacionPct" value={v.umbralDesviacionPct}
                onChange={set('umbralDesviacionPct')} className={CAMPO} style={{ background: 'var(--surface)' }} />
              <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
                A partir de cuánta diferencia se marca un viaje para revisión.
              </p>
            </div>
          </div>
        </fieldset>

        <fieldset className="pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <legend className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
            Formato de salida al ERP
          </legend>
          <div className="space-y-1.5">
            {FORMATOS.map((f) => (
              <label key={f.valor}
                className={`card p-2.5 flex items-start gap-2.5 ${f.implementado ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                style={f.implementado ? undefined : { opacity: 0.6 }}>
                <input type="radio" disabled={!f.implementado}
                  checked={v.salida === f.valor}
                  onChange={() => setV((p) => ({ ...p, salida: f.valor }))}
                  className="mt-0.5" />
                <span className="min-w-0">
                  <span className="text-[13px] font-medium block">
                    {f.rotulo}
                    {!f.implementado && (
                      <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded-full text-[10px] font-medium align-middle"
                        style={{ color: 'var(--muted)', background: 'var(--canvas)' }}>
                        aún no
                      </span>
                    )}
                  </span>
                  <span className="text-[11px]" style={{ color: 'var(--faint)' }}>{f.detalle}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="pt-3 border-t" style={{ borderColor: 'var(--line)' }}>
          <legend className="text-[11px] font-semibold uppercase tracking-wide mb-1.5" style={{ color: 'var(--muted)' }}>
            Catálogo de cuentas de tu contador
          </legend>
          <label htmlFor="aj-cuentas" className="sr-only">Catálogo de cuentas</label>
          <textarea id="aj-cuentas" name="cuentas" value={v.cuentas} onChange={set('cuentas')} rows={8}
            spellCheck={false}
            className="w-full text-[12.5px] px-3 py-2 rounded-lg hairline cifra-mono"
            style={{ background: 'var(--surface)' }} />
          <p className="text-[11px] mt-1" style={{ color: 'var(--faint)' }}>
            Una por línea: <span className="cifra-mono">concepto=cuenta</span>. Puedes pegar el bloque
            entero desde tu Excel.
          </p>
        </fieldset>

        {!revision.ok && (
          <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
            style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
            <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {revision.error}
          </div>
        )}
        {estado && !estado.ok && (
          <div className="flex items-start gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
            style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
            <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {estado.error}
          </div>
        )}
        {estado && estado.ok && (
          <div className="flex items-center gap-2 text-[12.5px] px-3.5 py-2.5 rounded-lg"
            style={{ background: 'var(--okbg)', color: 'var(--ok)' }}>
            <CheckCircle2 width={15} height={15} strokeWidth={1.75} />
            Ajustes guardados. Aplican a los viajes que se cuadren de aquí en adelante.
          </div>
        )}

        <Boton />
      </form>

      <aside className="space-y-3">
        <div className="card p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
            Qué cambia esto
          </h3>
          {previo === null ? (
            <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
              {!revision.ok
                ? 'Corrige lo de la izquierda para ver el efecto.'
                : 'Todavía no hay un viaje con kilómetros capturados con el cual enseñar el efecto. En cuanto exista, aquí se ve.'}
            </p>
          ) : (
            <>
              <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
                En un viaje de <span className="cifra-mono">{numero(ejemploKm!)} km</span> de
                tu operación, el motor va a esperar:
              </p>
              <div className="mt-2.5 space-y-1.5">
                <div className="flex justify-between gap-3 text-[13px]">
                  <span style={{ color: 'var(--muted)' }}>Diésel esperado</span>
                  <span className="cifra-mono font-medium">{litros(Math.round(previo.litros))}</span>
                </div>
                <div className="flex justify-between gap-3 text-[13px]">
                  <span style={{ color: 'var(--muted)' }}>A tu precio</span>
                  <span className="cifra-mono font-medium">{mxn(Math.round(previo.pesos))}</span>
                </div>
                <div className="flex justify-between gap-3 text-[13px] pt-1.5 border-t" style={{ borderColor: 'var(--line)' }}>
                  <span style={{ color: 'var(--muted)' }}>Se marca si se pasa de</span>
                  <span className="cifra-mono font-medium">
                    {mxn(Math.round(previo.pesos * (1 + previo.margen / 100)))}
                  </span>
                </div>
              </div>
              <p className="text-[11px] mt-2.5" style={{ color: 'var(--faint)' }}>
                Cuenta ilustrativa con el rendimiento por defecto. Una unidad con catálogo propio usa el suyo,
                y el precio real del ticket gana sobre el de aquí.
              </p>
            </>
          )}
        </div>

        <div className="card p-4">
          <h3 className="text-[11px] font-semibold uppercase tracking-wide mb-2" style={{ color: 'var(--muted)' }}>
            Lo que no se edita aquí
          </h3>
          <p className="text-[12.5px]" style={{ color: 'var(--muted)' }}>
            El estímulo del 50% de peaje, las claves de combustible del SAT y los topes de deducibilidad
            no tienen formulario a propósito: los fija la ley, no tu flota. Si la ley cambia, lo cambiamos
            nosotros para todos.
          </p>
        </div>
      </aside>
    </div>
  );
}
