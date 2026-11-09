'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save, TriangleAlert, CheckCircle2 } from 'lucide-react';
import { AvisoCompacto, CampoTexto, CampoTextarea, Disclosure, Fieldset, Radio, StatusChip } from '@/app/ui-v2/componentes';
import {
  validarAjustes, FORMATOS, type AjustesCrudos,
} from '@/lib/likida/ajustes_operativos';
import type { EstadoCatalogo } from './inicial';
// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta. Una cifra que se lee
// distinto en dos pantallas se lee como dos cálculos. (Este archivo hizo fallar
// esa prueba en su primera versión: el guardia sirve.)
import { mxn, numero, litros } from '@/lib/formato';

export type ResultadoGuardar = { ok: true } | { ok: false; error: string } | null;
export type AccionGuardar = (previo: ResultadoGuardar, fd: FormData) => Promise<ResultadoGuardar>;


function Boton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending}
      className="rv-btn rv-btn--primary"
      style={{ background: 'var(--marca)', color: 'var(--marca-fg)' }}>
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
export function FormaAjustes({ inicial, ejemploKm, ejemploIlegible = false, guardar, catalogo }: {
  inicial: AjustesCrudos;
  /** Los km de un viaje REAL de la flota, para que la vista previa hable de
   *  su operación y no de un viaje inventado. null = todavía no hay viajes
   *  con km capturados, y entonces se dice, no se rellena con un número. */
  ejemploKm: number | null;
  /** A37-S17-08: la lectura del viaje de ejemplo falló (distinto de «no hay viajes con km»). */
  ejemploIlegible?: boolean;
  guardar: AccionGuardar;
  /** AUDITORÍA 24, ARQ-3: si la flota declaró su catálogo o no. El textarea ya
   *  NO se prellena con las cuentas de la demo (`600-001`…), así que hay que
   *  decir por qué está vacío — y avisar si no se pudo leer, porque entonces
   *  guardar reemplazaría un catálogo que sí existe. */
  catalogo: EstadoCatalogo;
}) {
  const [estado, accion] = useActionState(guardar, null);
  const [v, setV] = useState<AjustesCrudos>(inicial);

  const set = (k: keyof AjustesCrudos) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setV((p) => ({ ...p, [k]: e.target.value }));

  const revision = useMemo(() => {
    try {
      return { ok: true as const, valor: validarAjustes(v, { permitirCatalogoVacio: catalogo === 'sin_declarar' }) };
    } catch (e) {
      return { ok: false as const, error: e instanceof Error ? e.message : 'Algo no cuadra.' };
    }
  }, [v, catalogo]);

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

        <Fieldset leyenda="Tabulador — con esto el motor calcula el diésel esperado">
          <div className="rv-forma__rejilla">
            <CampoTexto id="aj-rend" name="rendimientoPorDefecto" etiqueta="Rendimiento (km/L)" value={v.rendimientoPorDefecto}
              onChange={set('rendimientoPorDefecto')}
              ayuda="El de una unidad sin catálogo propio. Un tractocamión full anda entre 2 y 3.5." />
            <CampoTexto id="aj-factor" name="factorCarga" etiqueta="Factor de carga" value={v.factorCarga}
              onChange={set('factorCarga')}
              ayuda="Cuánto rinde cargado contra vacío (0.78 = rinde 78%). Siempre menor o igual a 1." />
            <CampoTexto id="aj-diesel" name="precioDieselPorDefecto" etiqueta="Precio del diésel (MXN/L)" value={v.precioDieselPorDefecto}
              onChange={set('precioDieselPorDefecto')}
              ayuda="Se usa cuando el ticket no trae precio por litro." />
            <CampoTexto id="aj-umbral" name="umbralDesviacionPct" etiqueta="Umbral de desviación (%)" value={v.umbralDesviacionPct}
              onChange={set('umbralDesviacionPct')}
              ayuda="A partir de cuánta diferencia se marca un viaje para revisión." />
          </div>
        </Fieldset>

        <Fieldset leyenda="Formato de salida al ERP">
          {FORMATOS.map((f) => (
            <Radio key={f.valor} name="formato_salida_ui" form="sin-formulario" disabled={!f.implementado}
              checked={v.salida === f.valor}
              onChange={() => setV((p) => ({ ...p, salida: f.valor }))}
              etiqueta={<>{f.rotulo}{!f.implementado && <> <StatusChip tono="muted">aún no</StatusChip></>}</>}
              ayuda={f.detalle} />
          ))}
        </Fieldset>

        <Fieldset leyenda="Catálogo de cuentas de tu contador">
          <CampoTextarea id="aj-cuentas" name="cuentas" etiqueta="Catálogo de cuentas" etiquetaOculta value={v.cuentas} onChange={set('cuentas')} rows={8}
            spellCheck={false} claseControl="cifra-mono"
            ayuda={<>Una por línea: <span className="cifra-mono">concepto=cuenta</span>. Puedes pegar el bloque entero desde tu Excel.</>} />
          {/* AUDITORÍA 24, ARQ-3: antes esto llegaba prellenado con las cuentas
              de la demo y se leía como el catálogo de la flota. Ahora solo se
              enseña lo DECLARADO, y cuando no hay nada se dice — la misma
              distinción «propia / heredada» que ya hace la pantalla de
              políticas. */}
          {catalogo === 'sin_declarar' && (
            <AvisoCompacto tono="warn"
              resumen="Todavía no declaraste tu catálogo. Mientras esté vacío, el export de póliza no puede escribir el archivo para tu ERP."
              mas="Estas cuentas son las de tu contador y nadie más las conoce, así que Likida no las inventa." />
          )}
          {catalogo === 'ilegible' && (
            <AvisoCompacto tono="error"
              resumen="No se pudo leer tu catálogo de cuentas. Vuelve a cargar la pantalla antes de guardar, o reemplazarías el catálogo que ya tienes."
              mas="Vacío aquí no quiere decir vacío allá." />
          )}
          {/* Sin estas cinco, el export de póliza para CONTPAQi y SAP no puede
              cuadrar el asiento y devuelve 409 diciendo cuál falta. Se listan
              aquí, con el nombre EXACTO que hay que teclear, porque antes el
              error mandaba a una pantalla que no existía.
              `iva_no_acreditable` se agregó en la AUDITORÍA 21 (ALTO): sin
              ella, un viaje con IVA no acreditado (o con IEPS de diésel, que
              este motor nunca acredita) descuadraba el periodo entero. */}
          <Disclosure variante="linea" titulo="Cuentas de balance que hacen falta">
            <p className="text-[11px]" style={{ color: 'var(--faint)' }}>
              Para exportar la póliza a tu ERP hacen falta, además de tus conceptos de gasto, estas
              cinco cuentas de balance:{' '}
              <span className="cifra-mono">iva_acreditable</span>,{' '}
              <span className="cifra-mono">iva_no_acreditable</span>,{' '}
              <span className="cifra-mono">anticipo_operador</span>,{' '}
              <span className="cifra-mono">por_cobrar_operador</span> y{' '}
              <span className="cifra-mono">por_pagar_operador</span>.
            </p>
          </Disclosure>
        </Fieldset>

        {!revision.ok && (
          <div className="flex items-start gap-2 text-[12px] px-3.5 py-2.5 rounded-lg"
            style={{ background: 'var(--warnbg)', color: 'var(--warn)' }}>
            <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {revision.error}
          </div>
        )}
        {estado && !estado.ok && (
          <div className="flex items-start gap-2 text-[12px] px-3.5 py-2.5 rounded-lg"
            style={{ background: 'var(--badbg)', color: 'var(--bad)' }}>
            <TriangleAlert width={15} height={15} strokeWidth={1.75} className="mt-0.5 shrink-0" />
            {estado.error}
          </div>
        )}
        {estado && estado.ok && (
          <div className="flex items-center gap-2 text-[12px] px-3.5 py-2.5 rounded-lg"
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
            <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
              {!revision.ok
                ? 'Corrige lo de la izquierda para ver el efecto.'
                : ejemploIlegible
                  ? 'No se pudo leer un viaje de tu flota para enseñar el efecto. No es que no haya viajes: la lectura falló. Recarga; si sigue, es cosa nuestra.'
                  : 'Todavía no hay un viaje con kilómetros capturados con el cual enseñar el efecto. En cuanto exista, aquí se ve.'}
            </p>
          ) : (
            <>
              <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
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
          <p className="text-[12px]" style={{ color: 'var(--muted)' }}>
            El estímulo del 50% de peaje, las claves de combustible del SAT y los topes de deducibilidad
            no tienen formulario a propósito: los fija la ley, no tu flota. Si la ley cambia, lo cambiamos
            nosotros para todos.
          </p>
        </div>
      </aside>
    </div>
  );
}
