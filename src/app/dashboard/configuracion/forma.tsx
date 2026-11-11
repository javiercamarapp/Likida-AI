'use client';

import { useMemo, useState, useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Save } from 'lucide-react';
import { Aviso, AvisoCompacto, Boton, CampoTexto, CampoTextarea, Disclosure, Fieldset, Icono, Radio, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import './configuracion.css';
import {
  validarAjustes, FORMATOS, type AjustesCrudos,
} from '@/lib/likida/ajustes_operativos';
import type { EstadoCatalogo } from './inicial';
// El formato de cifras vive SOLO en formato.ts — hay una prueba que falla si
// otro archivo formatea moneda mexicana por su cuenta. Una cifra que se lee
// distinto en dos pantallas se lee como dos cálculos. (Este archivo hizo fallar
// esa prueba en su primera versión: el guardia sirve.)
import { mxn, numero, litros } from '@/lib/formato';
import { useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';
import { rico } from '@/lib/i18n/rico';

export type ResultadoGuardar = { ok: true } | { ok: false; error: string } | null;
export type AccionGuardar = (previo: ResultadoGuardar, fd: FormData) => Promise<ResultadoGuardar>;


function BotonGuardar() {
  const { pending } = useFormStatus();
  return (
    <Boton type="submit" variante="primary" tamano="sm" loading={pending} icono={<Icono icono={Save} />}>
      {pending ? 'Guardando…' : 'Guardar ajustes'}
    </Boton>
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
  const { t, idioma } = useT('resto', restoEs);
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
    <div className="rv-cfg__split">
      <Tarjeta titulo={t('cfg.ajustes_de_tu_operacion')} info="configuracion.ajustes">
      <form action={accion} className="rv-cfg__forma">
        <input type="hidden" name="salida" value={v.salida} />

        <Fieldset leyenda={t('cfg.tabulador_con_esto_el_motor_calcula')}>
          <div className="rv-forma__rejilla">
            <CampoTexto id="aj-rend" name="rendimientoPorDefecto" etiqueta={t('cfg.rendimiento_km_l')} value={v.rendimientoPorDefecto}
              onChange={set('rendimientoPorDefecto')}
              ayuda={t('cfg.el_de_una_unidad_sin_catalogo')} />
            <CampoTexto id="aj-factor" name="factorCarga" etiqueta={t('cfg.factor_de_carga')} value={v.factorCarga}
              onChange={set('factorCarga')}
              ayuda={t('cfg.cuanto_rinde_cargado_contra_vacio_0')} />
            <CampoTexto id="aj-diesel" name="precioDieselPorDefecto" etiqueta={t('cfg.precio_del_diesel_mxn_l')} value={v.precioDieselPorDefecto}
              onChange={set('precioDieselPorDefecto')}
              ayuda={t('cfg.se_usa_cuando_el_ticket_no')} />
            <CampoTexto id="aj-umbral" name="umbralDesviacionPct" etiqueta={t('cfg.umbral_de_desviacion')} value={v.umbralDesviacionPct}
              onChange={set('umbralDesviacionPct')}
              ayuda={t('cfg.a_partir_de_cuanta_diferencia_se')} />
          </div>
        </Fieldset>

        <Fieldset leyenda={t('cfg.formato_de_salida_al_erp')}>
          {FORMATOS.map((f) => (
            <Radio key={f.valor} name="formato_salida_ui" form="sin-formulario" disabled={!f.implementado}
              checked={v.salida === f.valor}
              onChange={() => setV((p) => ({ ...p, salida: f.valor }))}
              etiqueta={<>{f.rotulo}{!f.implementado && <> <StatusChip tono="muted">aún no</StatusChip></>}</>}
              ayuda={f.detalle} />
          ))}
        </Fieldset>

        <Fieldset leyenda={t('cfg.catalogo_de_cuentas_de_tu_contador')}>
          <CampoTextarea id="aj-cuentas" name="cuentas" etiqueta={t('cfg.catalogo_de_cuentas')} etiquetaOculta value={v.cuentas} onChange={set('cuentas')} rows={8}
            spellCheck={false} claseControl="cifra-mono"
            ayuda={<>Una por línea: <span className="cifra-mono">concepto=cuenta</span>. Puedes pegar el bloque entero desde tu Excel.</>} />
          {/* AUDITORÍA 24, ARQ-3: antes esto llegaba prellenado con las cuentas
              de la demo y se leía como el catálogo de la flota. Ahora solo se
              enseña lo DECLARADO, y cuando no hay nada se dice — la misma
              distinción «propia / heredada» que ya hace la pantalla de
              políticas. */}
          {catalogo === 'sin_declarar' && (
            <AvisoCompacto tono="warn"
              resumen={t('cfg.todavia_no_declaraste_tu_catalogo_mientras')}
              mas={t('cfg.estas_cuentas_son_las_de_tu')} />
          )}
          {catalogo === 'ilegible' && (
            <AvisoCompacto tono="error"
              resumen={t('cfg.no_se_pudo_leer_tu_catalogo')}
              mas={t('cfg.vacio_aqui_no_quiere_decir_vacio')} />
          )}
          {/* Sin estas cinco, el export de póliza para CONTPAQi y SAP no puede
              cuadrar el asiento y devuelve 409 diciendo cuál falta. Se listan
              aquí, con el nombre EXACTO que hay que teclear, porque antes el
              error mandaba a una pantalla que no existía.
              `iva_no_acreditable` se agregó en la AUDITORÍA 21 (ALTO): sin
              ella, un viaje con IVA no acreditado (o con IEPS de diésel, que
              este motor nunca acredita) descuadraba el periodo entero. */}
          <Disclosure variante="linea" titulo={t('cfg.cuentas_de_balance_que_hacen_falta')}>
            <p className="rv-cfg__texto">{rico(t('cfg.para_exportar_la_poliza_a_tu'), { e0: (c) => <span className="cifra-mono">{c}</span>, e1: (c) => <span className="cifra-mono">{c}</span>, e2: (c) => <span className="cifra-mono">{c}</span>, e3: (c) => <span className="cifra-mono">{c}</span>, e4: (c) => <span className="cifra-mono">{c}</span> })}</p>
          </Disclosure>
        </Fieldset>

        {!revision.ok && <Aviso tono="warn">{revision.error}</Aviso>}
        {estado && !estado.ok && <Aviso tono="error">{estado.error}</Aviso>}
        {estado && estado.ok && <Aviso tono="ok">{t('cfg.ajustes_guardados_aplican_a_los_viajes')}</Aviso>}

        <div><BotonGuardar /></div>
      </form>
      </Tarjeta>

      <aside className="rv-cfg__lateral">
        <Tarjeta titulo={t('cfg.que_cambia_esto')}>
          {previo === null ? (
            <p className="rv-cfg__texto">
              {!revision.ok
                ? t('cfg.corrige_lo_de_la_izquierda_para')
                : ejemploIlegible
                  ? t('cfg.no_se_pudo_leer_un_viaje')
                  : t('cfg.todavia_no_hay_un_viaje_con')}
            </p>
          ) : (
            <>
              <p className="rv-cfg__texto">{rico(t('cfg.en_un_viaje_de_e0_km', { numero: numero(ejemploKm!, idioma) }), { e0: (c) => <span className="cifra-mono">{c}</span> })}</p>
              <div className="rv-cfg__lineas">
                <div className="rv-cfg__linea">{rico(t('cfg.e0_diesel_esperado_e0'), { e0: (c) => <span>{c}</span> })}<span className="cifra-mono">{litros(Math.round(previo.litros), idioma)}</span>
                </div>
                <div className="rv-cfg__linea">{rico(t('cfg.e0_a_tu_precio_e0'), { e0: (c) => <span>{c}</span> })}<span className="cifra-mono">{mxn(Math.round(previo.pesos), idioma)}</span>
                </div>
                <div className="rv-cfg__linea" data-total>{rico(t('cfg.e0_se_marca_si_se_pasa'), { e0: (c) => <span>{c}</span> })}<span className="cifra-mono">{mxn(Math.round(previo.pesos * (1 + previo.margen / 100)), idioma)}</span>
                </div>
              </div>
              <p className="rv-cfg__pie">{t('cfg.cuenta_ilustrativa_con_el_rendimiento_por')}</p>
            </>
          )}
        </Tarjeta>

        <Tarjeta titulo={t('cfg.lo_que_no_se_edita_aqui')}>
          <p className="rv-cfg__texto">{t('cfg.el_estimulo_del_50_de_peaje')}</p>
        </Tarjeta>
      </aside>
    </div>
  );
}
