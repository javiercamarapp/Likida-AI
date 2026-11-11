import type { ReactNode } from 'react';
import Link from 'next/link';
import { Activity, Wallet, Receipt, Cpu } from 'lucide-react';
import { mxn, numero, fechaCorta, fechaHoraMx } from '@/lib/formato';
import type { FichaCliente } from '@/lib/admin/ficha-cliente';
import type { InterruptorPipelineTenant } from '@/lib/admin/negocio';
import type { CasillaArranque } from '@/lib/admin/arranque';
import type { Persona } from '@/lib/admin/personas';
import { nombreDeRol } from '@/lib/auth/roles';
import { BotonEnlace, Icono, StatusChip, Tarjeta, TablaBase, type TonoEstado } from '../../../ui-v2/componentes';
import { Cifra, TiraCifras } from '../../../ui-v2/graficas';
import { FormaConAviso, type AccionDeForma } from '../../ui/forma';
import { CampoTexto } from '../../../ui-v2/componentes/campos';
import { SeccionInterruptores } from '../../observabilidad/interruptores-ui';
import { SeccionesFicha } from './secciones';

import type { TrDe } from '@/lib/i18n/tr_tipos';
import { trAdminFlotasEs } from '@/lib/i18n/tr_admin';
// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA 360 — el contenido, exportado (patrón page+contenido para poder mirarlo en preview sin sesión). Seis secciones:
// Resumen · Equipo · Plan y cobro · Arranque y fiscal · Controles · Baja. Cada sección degrada POR SU LADO a «no se pudo leer»:
// jamás un cero con cara de medición (los null vienen del lector, sección por sección).
// ═══════════════════════════════════════════════════════════════════════════

const TONO_SUSCRIPCION: Record<string, TonoEstado> = { activa: 'ok', prueba: 'neutral', morosa: 'bad', pausada: 'warn', cancelada: 'bad' };
const TONO_CORRIDA: Record<string, TonoEstado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };
const TONO_CASILLA: Record<CasillaArranque['estado'], TonoEstado> = { ok: 'ok', pendiente: 'warn', sin_medir: 'muted' };
const rotuloCasilla = (t: TrDe<'admin_flotas'>): Record<CasillaArranque['estado'], string> => ({ ok: t('ficha.hecho'), pendiente: t('ficha.pendiente'), sin_medir: t('flotas_ficha.sin_dato') });
export const SECCIONES_FICHA = ['resumen', 'equipo', 'plan', 'arranque', 'controles', 'baja'] as const;

export interface DatosArranque {
  casillas: CasillaArranque[];
  /** Slot de la declaración del 15 % (formulario con su acción). `undefined` = no se monta (previews). */
  declaracion?: ReactNode;
}

export function Ficha360({
  f, seccionInicial = 'resumen', personas, accesoLegible, arranque, interruptoresPipeline, accionInterruptorPipeline,
  agenteChofer, accionAgenteChofer, gestionPlan, t = trAdminFlotasEs,
}: {
  f: FichaCliente;
  seccionInicial?: string;
  /** Personas de ESTA flota. `null` = no se pudo leer. */
  personas?: Persona[] | null;
  /** `false` = no se pudo leer el último acceso (Auth): se pinta «sin dato», nunca «nunca entró». */
  accesoLegible?: boolean;
  /** `undefined` = la ficha no la monta (previews); `null` = la lectura falló. */
  arranque?: DatosArranque | null;
  /** El bloque «Plan de esta flota» (`GestionPlan`). `undefined` = no se monta (previews). */
  gestionPlan?: ReactNode;
  /** ADM-6: las palancas del pipeline del chofer de ESTA flota (mig. 0297). `null` = no se pudo leer. */
  interruptoresPipeline?: InterruptorPipelineTenant[] | null;
  accionInterruptorPipeline?: AccionDeForma;
  /** A5-01: la compuerta `agente_chofer_habilitado` (0859) de esta flota. */
  agenteChofer?: { habilitado: boolean; razon: 'habilitado' | 'apagado' | 'compuerta_ilegible' };
  accionAgenteChofer?: AccionDeForma; t?: TrDe<'admin_flotas'>;
}) {
  const id = f.tenant.id;

  const resumen = (
    <div className="rv-pila">
      <TiraCifras etiqueta={t('flotas_ficha.resumen_de', { nombre: f.tenant.nombre })}>
        <Cifra etiqueta={t('flotas_ficha.viajes_liquidados')} valor={f.operacion?.viajesLiquidados ?? null} formato="entero" estado={f.operacion ? 'ok' : 'error'} icono={<Icono icono={Activity} />} />
        <Cifra etiqueta={t('flotas_ficha.monto_comprobado')} valor={f.operacion?.montoComprobado ?? null} formato="mxn" estado={f.operacion ? 'ok' : 'error'} icono={<Icono icono={Wallet} />} />
        <Cifra etiqueta={t('flotas_ficha.liquidaciones_por_revisar')} valor={f.operacion?.porRevisar ?? null} formato="entero" estado={f.operacion ? 'ok' : 'error'} icono={<Icono icono={Receipt} />} />
        <Cifra
          etiqueta={t('flotas_ficha.costo_de_ia_30')} valor={f.consumoIa?.d30Usd ?? null} formato="usd" estado={f.consumoIa ? 'ok' : 'error'}
          nota={f.consumoIa ? t('flotas_ficha.usd_historico', { historicoUsd: numero(f.consumoIa.historicoUsd) }) : undefined} icono={<Icono icono={Cpu} />}
        />
      </TiraCifras>
      <Tarjeta titulo={t('flotas_ficha.origen')}>
        {!f.origenLegible ? <p>{t('flotas_ficha.origen_ilegible_ahora_mismo')}</p>
          : f.origen ? <p>{t('flotas_ficha.nacio_del_pipeline')} {f.origen.empresa} ({f.origen.fuente}{f.origen.cerradoEn ? `, cerrado ${fechaCorta(f.origen.cerradoEn)}` : ''}).</p>
            : <p>{t('flotas_ficha.no_nacio_del_pipeline')}</p>}
      </Tarjeta>
      <Tarjeta titulo={t('flotas_ficha.soporte')} estado={f.tickets === null ? 'error' : f.tickets.length === 0 ? 'vacio' : 'ok'} mensaje={f.tickets === null ? t('flotas_ficha.no_se_pudieron_leer') : t('flotas_ficha.sin_tickets_de_esta')}
        acciones={<BotonEnlace href="/admin/soporte" variante="ghost" tamano="sm">{t('flotas_ficha.ver_soporte')}</BotonEnlace>}>
        <TablaBase
          etiqueta={t('flotas_ficha.tickets_de_la_flota')} densa filas={(f.tickets ?? []).slice(0, 5)} idFila={(t) => t.id}
          columnas={[
            { id: 'asunto', titulo: t('flotas_ficha.asunto'), principal: true, celda: (t) => t.asunto },
            { id: 'estado', titulo: t('flotas_ficha.estado'), alinear: 'der', celda: (t) => (
              <StatusChip tono={t.estado === 'resuelto' ? 'ok' : t.horasRestantes !== null && t.horasRestantes < 0 ? 'bad' : 'neutral'}>{t.estado}</StatusChip>
            ) },
          ]}
        />
      </Tarjeta>
      <Tarjeta titulo={t('flotas_ficha.ultimas_corridas_de_agentes')} estado={f.corridas === null ? 'error' : f.corridas.length === 0 ? 'vacio' : 'ok'}
        mensaje={f.corridas === null ? t('flotas_ficha.no_se_pudieron_leer_2') : t('flotas_ficha.sin_corridas_de_agentes')}>
        <TablaBase
          etiqueta={t('flotas_ficha.corridas_de_agentes_de')} densa filas={f.corridas ?? []} idFila={(c) => `${c.agente}-${c.fin}`}
          columnas={[
            { id: 'agente', titulo: t('flotas_ficha.agente'), principal: true, celda: (c) => c.agente },
            { id: 'estado', titulo: t('flotas_ficha.estado'), celda: (c) => <StatusChip tono={TONO_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusChip> },
            { id: 'cuando', titulo: t('flotas_ficha.cuando'), alinear: 'der', celda: (c) => `${c.disparo} · ${fechaCorta(c.fin)}` },
          ]}
        />
      </Tarjeta>
    </div>
  );

  const equipo = (
    <Tarjeta
      titulo={t('flotas_ficha.personas_de_esta_flota')}
      estado={personas === null || personas === undefined ? 'error' : personas.length === 0 ? 'vacio' : 'ok'}
      mensaje={personas === null || personas === undefined ? t('flotas_ficha.no_se_pudo_leer') : t('flotas_ficha.nadie_puede_entrar_todavia')}
      detalle={t('flotas_ficha.da_de_alta_a')}
      acciones={(
        <>
          <BotonEnlace href={`/admin/equipo?flota=${id}`} variante="secondary" tamano="sm">{t('flotas_ficha.gestionar_en_equipo')}</BotonEnlace>
          <BotonEnlace href={`/admin/usuarios/nuevo?flota=${id}`} variante="primary" tamano="sm">{t('flotas_ficha.agregar_usuario')}</BotonEnlace>
        </>
      )}
    >
      <TablaBase
        etiqueta={t('flotas_ficha.personas_de_la_flota')} filas={personas ?? []} idFila={(p) => p.id}
        columnas={[
          { id: 'persona', titulo: t('flotas_ficha.persona'), principal: true, celda: (p) => <span>{p.nombre ?? '(sin nombre)'} <small>{p.email}</small></span> },
          { id: 'rol', titulo: t('flotas_ficha.rol'), celda: (p) => nombreDeRol(p.rol) },
          { id: 'estado', titulo: t('flotas_ficha.estado'), celda: (p) => (
            <StatusChip tono={p.estado === 'activa' ? 'ok' : p.estado === 'baja' ? 'muted' : 'bad'}>
              {p.estado === 'activa' ? 'Activa' : p.estado === 'baja' ? t('flotas_ficha.de_baja') : t('flotas_ficha.sin_cuenta_de_acceso')}
            </StatusChip>
          ) },
          { id: 'acceso', titulo: t('flotas_ficha.ultimo_acceso'), alinear: 'der', celda: (p) => !accesoLegible ? t('flotas_ficha.sin_dato') : p.nuncaEntro ? t('flotas_ficha.nunca_entro') : p.ultimoAcceso ? fechaHoraMx(p.ultimoAcceso) : '—' },
        ]}
      />
    </Tarjeta>
  );

  const plan = (
    <>
      <Tarjeta titulo={t('flotas_ficha.suscripcion')} estado={!f.suscripcionLegible ? 'error' : 'ok'} mensaje={t('flotas_ficha.no_se_pudo_leer_2')}>
        {f.suscripcion ? (
          <p>
            <StatusChip tono={TONO_SUSCRIPCION[f.suscripcion.estado] ?? 'neutral'}>{f.suscripcion.estado}</StatusChip>{' '}
            {f.suscripcion.planNombre} desde {fechaCorta(f.suscripcion.inicio)}
          </p>
        ) : <p>{t('flotas_ficha.sin_suscripcion_todavia_no')} {f.tenant.plan}.</p>}
      </Tarjeta>
      <Tarjeta titulo={t('flotas_ficha.facturas_saas')} estado={f.facturasSaas === null ? 'error' : f.facturasSaas.length === 0 ? 'vacio' : 'ok'}
        mensaje={f.facturasSaas === null ? t('flotas_ficha.no_se_pudieron_leer_3') : t('flotas_ficha.sin_facturas_emitidas')}
        acciones={<BotonEnlace href="/admin/costos-facturacion" variante="ghost" tamano="sm">{t('flotas_ficha.costos_y_facturacion')}</BotonEnlace>}>
        <TablaBase
          etiqueta={t('flotas_ficha.facturas_saas_de_la')} densa filas={f.facturasSaas ?? []} idFila={(x) => x.id}
          columnas={[
            { id: 'periodo', titulo: t('flotas_ficha.periodo'), principal: true, celda: (x) => `${fechaCorta(x.periodoInicio)} a ${fechaCorta(x.periodoFin)}` },
            { id: 'monto', titulo: t('flotas_ficha.monto'), alinear: 'der', celda: (x) => mxn(x.monto) },
            { id: 'estado', titulo: t('flotas_ficha.estado'), alinear: 'der', celda: (x) => x.estado },
          ]}
        />
      </Tarjeta>
      {gestionPlan !== undefined && <Tarjeta titulo={t('flotas_ficha.plan_de_esta_flota')}>{gestionPlan}</Tarjeta>}
    </>
  );

  const casillas = arranque?.casillas ?? [];
  const arranqueSec = (
    <>
      <Tarjeta titulo={t('flotas_ficha.arranque_de_la_flota')} estado={arranque === null ? 'error' : 'ok'} mensaje={t('flotas_ficha.no_se_pudo_leer_3')}>
        <TablaBase
          etiqueta={t('flotas_ficha.casillas_de_arranque')} densa filas={casillas} idFila={(c) => c.clave}
          columnas={[
            { id: 'casilla', titulo: t('flotas_ficha.casilla'), principal: true, celda: (c) => c.texto },
            { id: 'estado', titulo: t('flotas_ficha.estado'), celda: (c) => <StatusChip tono={TONO_CASILLA[c.estado]}>{rotuloCasilla(t)[c.estado]}</StatusChip> },
            { id: 'ir', titulo: t('flotas_ficha.resolver'), alinear: 'der', celda: (c) => c.estado === 'ok' ? '' : <Link href={c.href}>{c.accion}</Link> },
          ]}
        />
      </Tarjeta>
      <Tarjeta titulo={t('flotas_ficha.senales_de_uso')} estado={f.pmf ? 'ok' : 'error'} mensaje={t('flotas_ficha.no_se_pudieron_leer_4')}>
        {f.pmf && (
          <ul>
            <li>
              {f.pmf.descargas.medida
                ? t('flotas_ficha.pdf_de_liquidaciones_descargadas', { porCliente: numero(f.pmf.descargas.porCliente), liquidaciones: numero(f.pmf.descargas.liquidaciones), soloDemo: f.pmf.descargas.soloDemo > 0 ? ` (${numero(f.pmf.descargas.soloDemo)} solo demo, no cuentan)` : '' })
                : t('flotas_ficha.pdf_sin_liquidaciones_que')}
            </li>
            <li>
              {f.pmf.comprobacionSola.medida
                ? t('flotas_ficha.comprobacion_sola_de_viajes', { sinRecordatorio: numero(f.pmf.comprobacionSola.sinRecordatorio), liquidados: numero(f.pmf.comprobacionSola.liquidados) })
                : t('flotas_ficha.comprobacion_sola_sin_viajes')}
            </li>
            <li>
              {f.pmf.tickets.medida
                ? t('flotas_ficha.tickets_abiertos_por_la', { delCliente: numero(f.pmf.tickets.delCliente), deLikida: numero(f.pmf.tickets.deLikida) })
                : t('flotas_ficha.tickets_ninguno_todavia_a')}
            </li>
          </ul>
        )}
      </Tarjeta>
      {arranque?.declaracion !== undefined && <Tarjeta titulo={t('flotas_ficha.declaracion_del_15_rfa')}>{arranque.declaracion}</Tarjeta>}
    </>
  );

  const controles = (
    <>
      {interruptoresPipeline !== undefined && accionInterruptorPipeline && (
        <Tarjeta titulo={t('flotas_ficha.pipeline_del_chofer_palancas')} estado={interruptoresPipeline === null ? 'error' : 'ok'} mensaje={t('flotas_ficha.no_se_pudieron_leer_5')}>
          {interruptoresPipeline && (
            <SeccionInterruptores
              interruptores={interruptoresPipeline.map((i) => ({
                id: `pipeline:${i.pipeline}`, apagado: i.apagado, motivo: i.motivo, cambiadoPorNombre: i.cambiadoPorNombre, cambiadoEn: i.cambiadoEn,
              }))}
              accion={accionInterruptorPipeline}
            />
          )}
        </Tarjeta>
      )}
      {agenteChofer !== undefined && accionAgenteChofer && (
        <Tarjeta titulo={t('flotas_ficha.agente_5_escribirle_a')}>
          <p>
            <StatusChip tono={agenteChofer.habilitado ? 'ok' : agenteChofer.razon === 'compuerta_ilegible' ? 'bad' : 'neutral'}>
              {agenteChofer.habilitado ? 'Habilitado' : agenteChofer.razon === 'compuerta_ilegible' ? t('flotas_ficha.no_se_pudo_leer_4') : t('flotas_ficha.apagado')}
            </StatusChip>{' '}
            
            {t('flotas_ficha.mientras_este_apagado_el')}
          </p>
          <FormaConAviso
            accion={accionAgenteChofer} boton={agenteChofer.habilitado ? t('flotas_ficha.deshabilitar_el_agente_5') : t('flotas_ficha.habilitar_el_agente_5')} columnas="md:grid-cols-1"
            confirmar={agenteChofer.habilitado ? undefined : {
              titulo: t('flotas_ficha.habilitar_el_agente_5_2'),
              descripcion: t('flotas_ficha.desde_ahora_el_agente'),
              etiquetaConfirmar: t('flotas_ficha.si_habilitar'),
            }}
          >
            <input type="hidden" name="operacion" value={agenteChofer.habilitado ? 'deshabilitar' : 'habilitar'} />
            <CampoTexto etiqueta={t('flotas_ficha.motivo_queda_en_la')} name="motivo" required ayuda={t('flotas_ficha.ej_piloto_autorizado_por')} />
          </FormaConAviso>
        </Tarjeta>
      )}
    </>
  );

  const activas = (personas ?? []).filter((p) => p.activa).length;
  const baja = (
    <Tarjeta titulo={t('flotas_ficha.baja_de_la_flota')}>
      <p>
        {personas === null || personas === undefined
          ? t('flotas_ficha.no_se_pudo_leer_5')
          : `${numero(activas)} ${activas === 1 ? 'persona activa' : 'personas activas'} de ${numero(personas.length)}.`}
      </p>
      <p>
        
        {t('flotas_ficha.hoy_la_baja_se')}
      </p>
      <BotonEnlace href={`/admin/equipo?flota=${id}`} variante="secondary">{t('flotas_ficha.gestionar_personas_de_la')}</BotonEnlace>
    </Tarjeta>
  );

  return (
    <SeccionesFicha
      inicial={seccionInicial}
      secciones={[
        { valor: 'resumen', etiqueta: t('flotas_ficha.resumen'), contenido: resumen },
        { valor: 'equipo', etiqueta: t('flotas_ficha.equipo'), contenido: equipo },
        { valor: 'plan', etiqueta: t('flotas_ficha.plan_y_cobro'), contenido: plan },
        { valor: 'arranque', etiqueta: t('flotas_ficha.arranque_y_fiscal'), contenido: arranqueSec },
        { valor: 'controles', etiqueta: t('flotas_ficha.controles'), contenido: controles },
        { valor: 'baja', etiqueta: t('flotas_ficha.baja'), contenido: baja },
      ]}
    />
  );
}

/** El encabezado de la ficha (lo monta `page.tsx` dentro del ÚNICO `MarcoPagina` de la ruta, también cuando la lectura falla). */
export function encabezadoFicha(f: FichaCliente, t: TrDe<'admin_flotas'> = trAdminFlotasEs) {
  return {
    titulo: f.tenant.nombre,
    apoyo: t('flotas_ficha.plan', { plan: f.tenant.plan, creadoEn: f.tenant.creadoEn ? t('ficha.alta_fecha', { fecha: fechaCorta(f.tenant.creadoEn) }) : '' }),
    acciones: (
      <>
        <BotonEnlace href="/admin/flotas" variante="ghost">{t('flotas_ficha.volver_a_clientes')}</BotonEnlace>
        <BotonEnlace href={`/dashboard?tenant=${f.tenant.id}&rol=flota_admin`} variante="secondary">{t('flotas_ficha.ver_su_panel')}</BotonEnlace>
      </>
    ),
  };
}
