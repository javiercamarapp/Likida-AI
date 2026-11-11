'use client';

import '../vigia.css';
import { AvisoCompacto, BarraPeriodo, Chip, Boton as BotonV2, CampoSelect, CampoFecha, CampoTexto, CampoTextarea, Casilla, Disclosure, Fieldset, Icono, StatusChip, Tarjeta, AvisoResultado, type TonoEstado } from '@/app/ui-v2/componentes';
import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, ClipboardCopy, Send, Trash2, Truck } from 'lucide-react';
import type { GrupoDia, TarjetaAviso } from '@/lib/likida/vigia/aviso/bandeja';
import { AVISO_AUTOMATICO_CONECTADO, TEXTO_AVISO_AUTOMATICO_POR_CONECTAR, VACIO_BANDEJA_POR_CONECTAR } from '@/lib/likida/vigia/aviso/conexion';
import { useT } from '@/lib/i18n/proveedor';
import { agentes as agentesEs } from '@/lib/i18n/es/agentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { VacioAgente } from '@/app/dashboard/agentes/vacio-agente';
import { type TAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';
import { rico as ricoT } from '@/lib/i18n/rico';

// ═══════════════════════════════════════════════════════════════════════════
// LA BANDEJA «AVISOS DE VIAJE» (Agente 4, T-A4-22).
//
// El cliente pide, horas antes del servicio, la caja, las placas, la unidad y el operador (747a3730 ~00:21; ~02:40: aún
// «todavía me los pueden cambiar»). El sistema arma el aviso desde el programa, pero por defecto NINGUNO sale sin que una
// persona lo vea (E5, confirmación humana al inicio). Esta pantalla es ese ojo: qué se va a decir, qué datos tiene y de dónde
// salió cada uno, qué falta, y cuatro botones: Confirmar y enviar / Editar / Copiar y marcar enviado / Descartar.
// Cero pesos. Quien solo mira no ve botones ni teléfonos completos. Nada de texto libre se manda solo.
// ═══════════════════════════════════════════════════════════════════════════

export type ResultadoAviso = null | { ok: true; mensaje: string } | { ok: false; error: string };
export type AccionAviso = (previo: ResultadoAviso, fd: FormData) => Promise<ResultadoAviso>;

/** Regla provisional del «listo» (E4): hasta tener la leyenda de colores, caja + unidad + carta porte lista. */
export const ayudaReglaProvisional = (tx: TAgentes = TR_ES.t) => (tx('rest.regla_provisional_un_servicio_cuenta_como')
  + tx('rest.cambiara_cuando_tengamos_la_leyenda_de'));
export const AYUDA_REGLA_PROVISIONAL = ayudaReglaProvisional();

export const politicaPrivacidad = (tx: TAgentes = TR_ES.t) => (tx('rest.privacidad_al_cliente_solo_le_llegan')
  + tx('rest.la_licencia_su_vigencia_y_el_2')
  + tx('rest.de_la_flota_no_los_habilite'));
export const POLITICA_PRIVACIDAD = politicaPrivacidad();

const vacioTodos = (tx: TAgentes = TR_ES.t) => (AVISO_AUTOMATICO_CONECTADO
  ? tx('rest.aun_no_hay_avisos_de_viaje')
  : VACIO_BANDEJA_POR_CONECTAR);
const vacioPendientes = (tx: TAgentes = TR_ES.t) => (tx('rest.no_hay_avisos_esperando_a_nadie'));

/** AAAA-MM-DD → DD/MM/AAAA, sin pasar por Date. */
function dia(fecha: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : fecha || 'Sin fecha';
}

const TONO_ESTADO: Record<string, TonoEstado> = {
  pendiente_confirmacion: 'warn',
  sin_destinatario: 'warn',
  fallido: 'bad',
  enviado: 'ok',
  aprobado: 'muted',
  descartado: 'muted',
  borrador: 'muted',
  reemplazado: 'muted',
};

function Aviso({ children }: { children: React.ReactNode }) {
  return <AvisoCompacto tono="error" resumen={children} />;
}

function Boton({ accion, children, tono }: { accion: string; children: React.ReactNode; tono?: 'peligro' }) {
  const { pending } = useFormStatus();
  return (
    <BotonV2 type="submit" name="accion" value={accion} loading={pending} tamano="sm" variante={tono === 'peligro' ? 'danger' : 'secondary'}>
      {children}
    </BotonV2>
  );
}

/** «Copiar y marcar enviado»: copia el texto al portapapeles y, en el mismo toque, deja constancia de que ya salió. */
function BotonCopiar({ texto }: { texto: string }) {
  const { t: tx } = useT('agentes', agentesEs);
  const { pending } = useFormStatus();
  return (
    <BotonV2
      type="submit" name="accion" value="copiar" loading={pending} tamano="sm" icono={<Icono icono={ClipboardCopy} tam={14} />}
      onClick={() => {
        try { void navigator.clipboard?.writeText(texto); } catch { /* sin portapapeles: el texto sigue a la vista para copiarlo a mano */ }
      }}
    >{tx('rest.copiar_y_marcar_enviado')}</BotonV2>
  );
}

function TarjetaAvisoViaje({ t, accion, puedeDecidir }: { t: TarjetaAviso; accion: AccionAviso; puedeDecidir: boolean }) {
  const { t: tx } = useT('agentes', agentesEs);
  const [estado, despachar] = useActionState(accion, null);
  const p = t.puede;
  return (
    <article className="rv-vg__bloque" aria-labelledby={`aviso-${t.id}`} data-estado={t.estado}>
      <header className="rv-vg__linea">
        <div>
          <h4 id={`aviso-${t.id}`} className="rv-vg__titulo">{t.servicio}</h4>
          <p className="rv-vg__nota">
            {t.cita ? `Cita: ${t.cita} · ` : ''}{t.canalRotulo}
          </p>
        </div>
        <div className="rv-vg__fin rv-vg__der">
          <span data-testid="estado"><StatusChip tono={TONO_ESTADO[t.estado] ?? 'neutral'}>{t.estadoRotulo}</StatusChip></span>
          <p className="rv-vg__nota">{tx('rest.version')}{' '}{t.version}{t.tipo === 'actualizacion' ? tx('rest.actualizacion') : t.tipo === 'cancelacion' ? tx('rest.cancelacion') : ''}
            {t.editadoPorPersona ? ' · editado a mano' : ''}
          </p>
        </div>
      </header>

      {t.interno ? (
        <p className="rv-vg__nota">{tx('rest.alerta_interna_para_la_oficina_no')}</p>
      ) : null}
      {t.cambio ? <p className="rv-vg__nota" data-testid="cambio">{ricoT(tx('rest.strong_que_cambio_strong'), { strong: (c) => <strong>{c}</strong> })}{' '}{t.cambio}</p> : null}

      {t.errorLlano ? <Aviso>{t.errorLlano}</Aviso> : null}
      {t.causas.length > 0 ? (
        <ul className="rv-vg__bullets" aria-label={tx('rest.por_que_no_hay_destinatario')} data-tono="bad">
          {t.causas.map((c) => <li key={c}>{c}</li>)}
        </ul>
      ) : null}

      <div className="rv-vg__cuad">
        <div className="rv-vg__pila--s">
          <p className="rv-vg__rotulo">{tx('rest.que_datos_tiene')}</p>
          {t.tiene.length > 0 ? (
            <ul className="rv-vg__ul" aria-label={tx('rest.datos_que_tiene')}>
              {t.tiene.map((d) => (
                <li key={d.campo}>
                  <span className="rv-vg__medio">{d.rotulo}:</span> {d.valor} <span className="rv-vg__muted">({d.fuente})</span>
                </li>
              ))}
            </ul>
          ) : <p className="rv-vg__nota">{tx('rest.todavia_no_tiene_ningun_dato')}</p>}
        </div>
        <div className="rv-vg__pila--s">
          <p className="rv-vg__rotulo">{tx('cobranza.gasto.que_falta')}</p>
          {t.faltan.length > 0 ? (
            <ul className="rv-vg__bullets" aria-label={tx('rest.datos_que_faltan')} data-tono="bad">
              {t.faltan.map((f) => <li key={f.campo}>{f.texto}</li>)}
            </ul>
          ) : <p className="rv-vg__nota">{tx('rest.no_falta_nada')}</p>}
        </div>
      </div>

      <div className="rv-vg__pila--s">
        <p className="rv-vg__rotulo">{tx('rest.lo_que_se_le_va_a')}</p>
        <pre className="rv-vg__texto" data-testid="texto">{t.texto}</pre>
      </div>

      {puedeDecidir ? (
        <>
          <form action={despachar} className="rv-vg__linea">
            <input type="hidden" name="id" value={t.id} />
            {p.confirmar ? <Boton accion="confirmar"><Icono icono={Send} tam={14} />{tx('rest.confirmar_y_enviar')}</Boton> : null}
            {p.copiar ? <BotonCopiar texto={t.texto} /> : null}
          </form>

          {p.editar ? (
            <Disclosure titulo={tx('rest.editar')} variante="linea">
              <form action={despachar} className="rv-vg__pila">
                <input type="hidden" name="id" value={t.id} />
                <CampoTextarea etiqueta={tx('rest.texto_del_aviso_hasta_1_000')} name="texto" required maxLength={1000} rows={6} defaultValue={t.texto} />
                <div><Boton accion="editar"><Icono icono={Check} tam={14} />{tx('rest.guardar_el_texto')}</Boton></div>
              </form>
            </Disclosure>
          ) : null}

          {p.capturar ? (
            <Disclosure titulo={tx('rest.capturar_lo_que_falta')} variante="linea">
              <form action={despachar} className="rv-vg__pila">
                <input type="hidden" name="id" value={t.id} />
                <div className="rv-vg__cuad">
                  <CampoTexto etiqueta={tx('conductores.forma.operador')} name="operadorNombre" maxLength={120} autoComplete="off" />
                  <CampoTexto etiqueta={tx('rest.placas_de_la_unidad')} name="placasUnidad" maxLength={14} autoComplete="off" />
                  <CampoTexto etiqueta={tx('rest.placas_de_la_caja')} name="placasCaja" maxLength={14} autoComplete="off" />
                  <CampoSelect etiqueta={tx('rest.estado_de_la_caja')} name="estadoCaja" defaultValue="">
                    <option value="">{tx('rest.no_cambiar')}</option>
                    <option value="vacia">{tx('rest.vacia')}</option>
                    <option value="cargada">{tx('rest.cargada')}</option>
                    <option value="en_patio">{tx('rest.en_patio')}</option>
                    <option value="en_transito">{tx('rest.en_transito')}</option>
                    <option value="desconocido">{tx('rest.desconocido')}</option>
                  </CampoSelect>
                  <CampoTexto etiqueta={tx('rest.licencia_no_se_envia_al_cliente')} name="licencia" maxLength={40} autoComplete="off" />
                  <CampoFecha etiqueta={tx('rest.vigencia_de_la_licencia_no_se')} name="licenciaVence" />
                  <CampoTexto etiqueta={tx('rest.telefono_del_operador_no_se_envia')} name="telefono" tipo="tel" inputMode="tel" maxLength={16} autoComplete="off" />
                </div>
                <div data-testid="borrar-datos">
                  <Fieldset leyenda={tx('rest.quitar_un_dato_mal_escrito_dejalo')}>
                    <div className="rv-vg__linea">
                      {([['operadorNombre', 'Operador'], ['placasUnidad', 'Placas unidad'], ['placasCaja', 'Placas caja'], ['estadoCaja', 'Estado caja'], ['licencia', 'Licencia'], ['licenciaVence', 'Vigencia'], ['telefono', tx('rest.telefono')]] as const).map(([v, r]) => (
                        <Casilla key={v} name="borrar" value={v} etiqueta={r} />
                      ))}
                    </div>
                  </Fieldset>
                </div>
                <p className="rv-vg__nota" data-testid="privacidad">{politicaPrivacidad(tx)}</p>
                <div><Boton accion="capturar"><Icono icono={Truck} tam={14} />{tx('rest.guardar_los_datos')}</Boton></div>
              </form>
            </Disclosure>
          ) : null}

          {p.descartar ? (
            <Disclosure titulo={tx('rest.descartar')} variante="linea">
              <form action={despachar} className="rv-vg__pila">
                <input type="hidden" name="id" value={t.id} />
                <p className="rv-vg__nota">{tx('rest.este_aviso_no_se_enviara_si')}</p>
                <div><Boton accion="descartar" tono="peligro"><Icono icono={Trash2} tam={14} />{tx('rest.si_descartar')}</Boton></div>
              </form>
            </Disclosure>
          ) : null}
        </>
      ) : null}

      {estado ? <AvisoResultado estado={estado} /> : null}
    </article>
  );
}

export function VistaAvisosVigia({ sufijo, grupos, total, hayMas = false, pendientes, soloPendientes, puedeDecidir, avisoEncendido, errorLectura, sinMigrar, accion }: {
  sufijo: string;
  grupos: GrupoDia[];
  /** Cuántos avisos hay en la lista que se está viendo. */
  total: number;
  /** La lista llegó al tope de la bandeja: puede haber avisos más viejos que no se muestran (A37-S58-07). */
  hayMas?: boolean;
  /** Cuántos avisos esperan a una persona (`contarPendientes`). `null`/`undefined` = no se pudo contar: «—», nunca un cero. */
  pendientes?: number | null;
  soloPendientes: boolean;
  /** Solo el dueño y el encargado deciden; el resto mira (sin botones y sin teléfonos completos). */
  puedeDecidir: boolean;
  /** `null` = no se pudo leer la configuración. */
  avisoEncendido: boolean | null;
  /** Mensaje llano si la lista no se pudo leer. */
  errorLectura: string | null;
  /** La migración 0797 aún no está en la base. */
  sinMigrar: boolean;
  accion: AccionAviso;
}) {
  const { t: tx } = useT('agentes', agentesEs);
  const base = `/dashboard/agentes/vigia/avisos${sufijo}`;
  const conPendientes = `${base}${sufijo ? '&' : '?'}pendientes=1`;
  const sinLectura = sinMigrar || !!errorLectura;
  const tarjetas = grupos.flatMap((g) => g.clientes.flatMap((c) => c.tarjetas));
  const mas = hayMas ? '+' : '';
  const nPend = typeof pendientes === 'number' ? pendientes : null;
  // Bandeja (Rovaq «Avisos»): segmentado Pendientes N / Todos → tira de 2 → UNA tarjeta de lista. Máximo dos avisos arriba:
  // primero lo que impide leer, luego lo que explica por qué nada sale solo.
  const avisosArriba: React.ReactNode[] = [];
  if (sinMigrar) avisosArriba.push(<Aviso key="migrar">{tx('rest.la_base_de_datos_todavia_no')}</Aviso>);
  if (errorLectura) avisosArriba.push(<Aviso key="error">{errorLectura}</Aviso>);
  if (!AVISO_AUTOMATICO_CONECTADO) avisosArriba.push(<div key="por-conectar" data-testid="por-conectar"><AvisoCompacto tono="warn" resumen={TEXTO_AVISO_AUTOMATICO_POR_CONECTAR} /></div>);
  if (avisoEncendido === false) avisosArriba.push(<AvisoCompacto key="apagado" tono="warn" resumen={tx('rest.el_aviso_de_viaje_esta_apagado_4')} />);
  return (
    <EsqueletoTablaMaestra
      titulo={tx('vigia.vista.sello_avisos_de_viaje')}
      apoyo={tx('rest.los_avisos_que_el_vigia_arma')}
      filtros={(
        <BarraPeriodo
          etiqueta={tx('f26d2.avisos.filtro')}
          periodo={{
            etiqueta: tx('f26d2.avisos.filtro'),
            valor: soloPendientes ? 'pendientes' : 'todos',
            opciones: [
              { valor: 'pendientes', etiqueta: nPend === null ? tx('f26d2.avisos.pendientes') : `${tx('f26d2.avisos.pendientes')} ${nPend}`, href: conPendientes },
              { valor: 'todos', etiqueta: tx('f26d2.avisos.todos'), href: base },
            ],
          }}
        />
      )}
      avisos={avisosArriba.length > 0 ? <>{avisosArriba.slice(0, 2)}</> : undefined}
      // La tira es de DOS cifras reales: lo que espera a una persona (con «Al día» cuando no hay nada) y lo cargado en la lista.
      // Sin lectura de la lista, ambas dicen «sin dato»; con el tope de la bandeja la cuenta es parcial y lleva «+».
      cifras={[
        sinLectura || nPend === null
          ? { etiqueta: tx('f26d2.avisos.sin_atender'), valor: null, estado: 'vacio', mensaje: tx('f26d2.avisos.sin_dato') }
          : { etiqueta: tx('f26d2.avisos.sin_atender'), valor: nPend, tono: nPend === 0 ? 'ok' : 'warn', nota: nPend === 0 ? tx('f26d2.avisos.nadie_espera') : tx('f26d2.avisos.esperan_decision') },
        sinLectura
          ? { etiqueta: tx('f26d2.avisos.cargados'), valor: null, estado: 'vacio', mensaje: tx('f26d2.avisos.sin_dato') }
          : { etiqueta: tx('f26d2.avisos.cargados'), valor: `${total}${mas}`, nota: soloPendientes ? tx('f26d2.avisos.en_vista_pendientes') : tx('f26d2.avisos.en_vista_todos') },
      ]}
      etiquetaCifras={tx('vigia.vista.sello_avisos_de_viaje')}
    >
      <Tarjeta titulo={tx('f26d2.avisos.tarjeta')} acciones={!sinLectura ? <Chip tono="neutral" tamano="estado">{total}{mas}</Chip> : undefined}>
        {!sinLectura && total === 0 ? (
          <div data-testid="vacio"><VacioAgente titulo={tx('rest.sin_avisos_que_revisar')}>{soloPendientes ? vacioPendientes(tx) : vacioTodos(tx)}</VacioAgente></div>
        ) : null}
        {sinLectura ? <VacioAgente titulo={tx('f26d2.avisos.sin_lectura')}>{tx('f26d2.avisos.sin_lectura_texto')}</VacioAgente> : null}

        {hayMas ? (
          <p className="rv-vg__nota" data-testid="hay-mas">{tx('rest.se_muestran_los_avisos_mas_recientes', { total })}{' '}{soloPendientes ? tx('rest.resuelve_los_pendientes_para_ver_el') : tx('rest.usa_solo_pendientes_para_ver_lo')}
          </p>
        ) : null}

        {grupos.length > 0 ? (
          <div className="rv-vg__pila">
            {grupos.map((g) => (
              <section key={g.fecha || 'sin-fecha'} className="rv-vg__pila" aria-label={dia(g.fecha)}>
                <h3 className="rv-vg__dia">{dia(g.fecha)}</h3>
                {g.clientes.map((c) => (
                  <div key={c.cliente} className="rv-vg__pila">
                    <p className="rv-vg__rotulo">{c.cliente}</p>
                    {c.tarjetas.map((t) => <TarjetaAvisoViaje key={t.id} t={t} accion={accion} puedeDecidir={puedeDecidir} />)}
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : null}

        <div className="rv-vg__notas">
          <p className="rv-vg__nota" data-testid="ayuda">{ayudaReglaProvisional(tx)}</p>
          {avisoEncendido === null && !sinMigrar && !errorLectura ? (
            <p className="rv-vg__nota">{tx('rest.no_pude_confirmar_si_el_aviso')}</p>
          ) : null}
          {!puedeDecidir ? (
            <p className="rv-vg__nota">{tx('rest.solo_el_dueno_o_el_encargado_4')}</p>
          ) : null}
        </div>
      </Tarjeta>
    </EsqueletoTablaMaestra>
  );
}
