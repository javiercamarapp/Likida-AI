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

// ═══════════════════════════════════════════════════════════════════════════
// LA FICHA 360 — el contenido, exportado (patrón page+contenido para poder mirarlo en preview sin sesión). Seis secciones:
// Resumen · Equipo · Plan y cobro · Arranque y fiscal · Controles · Baja. Cada sección degrada POR SU LADO a «no se pudo leer»:
// jamás un cero con cara de medición (los null vienen del lector, sección por sección).
// ═══════════════════════════════════════════════════════════════════════════

const TONO_SUSCRIPCION: Record<string, TonoEstado> = { activa: 'ok', prueba: 'neutral', morosa: 'bad', pausada: 'warn', cancelada: 'bad' };
const TONO_CORRIDA: Record<string, TonoEstado> = { ok: 'ok', parcial: 'warn', fallo: 'bad' };
const TONO_CASILLA: Record<CasillaArranque['estado'], TonoEstado> = { ok: 'ok', pendiente: 'warn', sin_medir: 'muted' };
const ROTULO_CASILLA: Record<CasillaArranque['estado'], string> = { ok: 'Hecho', pendiente: 'Pendiente', sin_medir: 'Sin dato' };
export const SECCIONES_FICHA = ['resumen', 'equipo', 'plan', 'arranque', 'controles', 'baja'] as const;

export interface DatosArranque {
  casillas: CasillaArranque[];
  /** Slot de la declaración del 15 % (formulario con su acción). `undefined` = no se monta (previews). */
  declaracion?: ReactNode;
}

export function Ficha360({
  f, seccionInicial = 'resumen', personas, accesoLegible, arranque, interruptoresPipeline, accionInterruptorPipeline,
  agenteChofer, accionAgenteChofer, gestionPlan,
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
  accionAgenteChofer?: AccionDeForma;
}) {
  const id = f.tenant.id;

  const resumen = (
    <div className="rv-pila">
      <TiraCifras etiqueta={`Resumen de ${f.tenant.nombre}`}>
        <Cifra etiqueta="Viajes liquidados" valor={f.operacion?.viajesLiquidados ?? null} formato="entero" estado={f.operacion ? 'ok' : 'error'} icono={<Icono icono={Activity} />} />
        <Cifra etiqueta="Monto comprobado" valor={f.operacion?.montoComprobado ?? null} formato="mxn" estado={f.operacion ? 'ok' : 'error'} icono={<Icono icono={Wallet} />} />
        <Cifra etiqueta="Liquidaciones por revisar" valor={f.operacion?.porRevisar ?? null} formato="entero" estado={f.operacion ? 'ok' : 'error'} icono={<Icono icono={Receipt} />} />
        <Cifra
          etiqueta="Costo de IA, 30 días" valor={f.consumoIa?.d30Usd ?? null} formato="usd" estado={f.consumoIa ? 'ok' : 'error'}
          nota={f.consumoIa ? `${numero(f.consumoIa.historicoUsd)} USD histórico` : undefined} icono={<Icono icono={Cpu} />}
        />
      </TiraCifras>
      <Tarjeta titulo="Origen">
        {!f.origenLegible ? <p>Origen ilegible ahora mismo.</p>
          : f.origen ? <p>Nació del pipeline: {f.origen.empresa} ({f.origen.fuente}{f.origen.cerradoEn ? `, cerrado ${fechaCorta(f.origen.cerradoEn)}` : ''}).</p>
            : <p>No nació del pipeline de prospectos: alta directa.</p>}
      </Tarjeta>
      <Tarjeta titulo="Soporte" estado={f.tickets === null ? 'error' : f.tickets.length === 0 ? 'vacio' : 'ok'} mensaje={f.tickets === null ? 'No se pudieron leer los tickets' : 'Sin tickets de esta flota'}
        acciones={<BotonEnlace href="/admin/soporte" variante="ghost" tamano="sm">Ver soporte</BotonEnlace>}>
        <TablaBase
          etiqueta="Tickets de la flota" densa filas={(f.tickets ?? []).slice(0, 5)} idFila={(t) => t.id}
          columnas={[
            { id: 'asunto', titulo: 'Asunto', principal: true, celda: (t) => t.asunto },
            { id: 'estado', titulo: 'Estado', alinear: 'der', celda: (t) => (
              <StatusChip tono={t.estado === 'resuelto' ? 'ok' : t.horasRestantes !== null && t.horasRestantes < 0 ? 'bad' : 'neutral'}>{t.estado}</StatusChip>
            ) },
          ]}
        />
      </Tarjeta>
      <Tarjeta titulo="Últimas corridas de agentes" estado={f.corridas === null ? 'error' : f.corridas.length === 0 ? 'vacio' : 'ok'}
        mensaje={f.corridas === null ? 'No se pudieron leer las corridas' : 'Sin corridas de agentes'}>
        <TablaBase
          etiqueta="Corridas de agentes de la flota" densa filas={f.corridas ?? []} idFila={(c) => `${c.agente}-${c.fin}`}
          columnas={[
            { id: 'agente', titulo: 'Agente', principal: true, celda: (c) => c.agente },
            { id: 'estado', titulo: 'Estado', celda: (c) => <StatusChip tono={TONO_CORRIDA[c.estado] ?? 'neutral'}>{c.estado}</StatusChip> },
            { id: 'cuando', titulo: 'Cuándo', alinear: 'der', celda: (c) => `${c.disparo} · ${fechaCorta(c.fin)}` },
          ]}
        />
      </Tarjeta>
    </div>
  );

  const equipo = (
    <Tarjeta
      titulo="Personas de esta flota"
      estado={personas === null || personas === undefined ? 'error' : personas.length === 0 ? 'vacio' : 'ok'}
      mensaje={personas === null || personas === undefined ? 'No se pudo leer el equipo' : 'Nadie puede entrar todavía'}
      detalle="Da de alta a su primer usuario para que pueda entrar a su panel."
      acciones={(
        <>
          <BotonEnlace href={`/admin/equipo?flota=${id}`} variante="secondary" tamano="sm">Gestionar en Equipo</BotonEnlace>
          <BotonEnlace href={`/admin/usuarios/nuevo?flota=${id}`} variante="primary" tamano="sm">Agregar usuario</BotonEnlace>
        </>
      )}
    >
      <TablaBase
        etiqueta="Personas de la flota" filas={personas ?? []} idFila={(p) => p.id}
        columnas={[
          { id: 'persona', titulo: 'Persona', principal: true, celda: (p) => <span>{p.nombre ?? '(sin nombre)'} <small>{p.email}</small></span> },
          { id: 'rol', titulo: 'Rol', celda: (p) => nombreDeRol(p.rol) },
          { id: 'estado', titulo: 'Estado', celda: (p) => (
            <StatusChip tono={p.estado === 'activa' ? 'ok' : p.estado === 'baja' ? 'muted' : 'bad'}>
              {p.estado === 'activa' ? 'Activa' : p.estado === 'baja' ? 'De baja' : 'Sin cuenta de acceso'}
            </StatusChip>
          ) },
          { id: 'acceso', titulo: 'Último acceso', alinear: 'der', celda: (p) => !accesoLegible ? 'Sin dato' : p.nuncaEntro ? 'Nunca entró' : p.ultimoAcceso ? fechaHoraMx(p.ultimoAcceso) : '—' },
        ]}
      />
    </Tarjeta>
  );

  const plan = (
    <>
      <Tarjeta titulo="Suscripción" estado={!f.suscripcionLegible ? 'error' : 'ok'} mensaje="No se pudo leer la suscripción">
        {f.suscripcion ? (
          <p>
            <StatusChip tono={TONO_SUSCRIPCION[f.suscripcion.estado] ?? 'neutral'}>{f.suscripcion.estado}</StatusChip>{' '}
            {f.suscripcion.planNombre} desde {fechaCorta(f.suscripcion.inicio)}
          </p>
        ) : <p>Sin suscripción: todavía no es cliente de pago. Plan registrado: {f.tenant.plan}.</p>}
      </Tarjeta>
      <Tarjeta titulo="Facturas SaaS" estado={f.facturasSaas === null ? 'error' : f.facturasSaas.length === 0 ? 'vacio' : 'ok'}
        mensaje={f.facturasSaas === null ? 'No se pudieron leer las facturas' : 'Sin facturas emitidas'}
        acciones={<BotonEnlace href="/admin/costos-facturacion" variante="ghost" tamano="sm">Costos y facturación</BotonEnlace>}>
        <TablaBase
          etiqueta="Facturas SaaS de la flota" densa filas={f.facturasSaas ?? []} idFila={(x) => x.id}
          columnas={[
            { id: 'periodo', titulo: 'Periodo', principal: true, celda: (x) => `${fechaCorta(x.periodoInicio)} a ${fechaCorta(x.periodoFin)}` },
            { id: 'monto', titulo: 'Monto', alinear: 'der', celda: (x) => mxn(x.monto) },
            { id: 'estado', titulo: 'Estado', alinear: 'der', celda: (x) => x.estado },
          ]}
        />
      </Tarjeta>
      {gestionPlan !== undefined && <Tarjeta titulo="Plan de esta flota">{gestionPlan}</Tarjeta>}
    </>
  );

  const casillas = arranque?.casillas ?? [];
  const arranqueSec = (
    <>
      <Tarjeta titulo="Arranque de la flota" estado={arranque === null ? 'error' : 'ok'} mensaje="No se pudo leer el arranque">
        <TablaBase
          etiqueta="Casillas de arranque" densa filas={casillas} idFila={(c) => c.clave}
          columnas={[
            { id: 'casilla', titulo: 'Casilla', principal: true, celda: (c) => c.texto },
            { id: 'estado', titulo: 'Estado', celda: (c) => <StatusChip tono={TONO_CASILLA[c.estado]}>{ROTULO_CASILLA[c.estado]}</StatusChip> },
            { id: 'ir', titulo: 'Resolver', alinear: 'der', celda: (c) => c.estado === 'ok' ? '' : <Link href={c.href}>{c.accion}</Link> },
          ]}
        />
      </Tarjeta>
      <Tarjeta titulo="Señales de uso" estado={f.pmf ? 'ok' : 'error'} mensaje="No se pudieron leer las señales de uso">
        {f.pmf && (
          <ul>
            <li>
              {f.pmf.descargas.medida
                ? `PDF: ${numero(f.pmf.descargas.porCliente)} de ${numero(f.pmf.descargas.liquidaciones)} liquidaciones descargadas por el cliente${f.pmf.descargas.soloDemo > 0 ? ` (${numero(f.pmf.descargas.soloDemo)} solo demo, no cuentan)` : ''}`
                : 'PDF: sin liquidaciones que medir'}
            </li>
            <li>
              {f.pmf.comprobacionSola.medida
                ? `Comprobación sola: ${numero(f.pmf.comprobacionSola.sinRecordatorio)} de ${numero(f.pmf.comprobacionSola.liquidados)} viajes cerraron sin recordatorio`
                : 'Comprobación sola: sin viajes liquidados que medir'}
            </li>
            <li>
              {f.pmf.tickets.medida
                ? `Tickets: ${numero(f.pmf.tickets.delCliente)} abiertos por la flota y ${numero(f.pmf.tickets.deLikida)} por Likida`
                : 'Tickets: ninguno todavía; a esta escala es ausencia de dato, no buena señal'}
            </li>
          </ul>
        )}
      </Tarjeta>
      {arranque?.declaracion !== undefined && <Tarjeta titulo="Declaración del 15 % (RFA 2.9)">{arranque.declaracion}</Tarjeta>}
    </>
  );

  const controles = (
    <>
      {interruptoresPipeline !== undefined && accionInterruptorPipeline && (
        <Tarjeta titulo="Pipeline del chofer: palancas de esta flota" estado={interruptoresPipeline === null ? 'error' : 'ok'} mensaje="No se pudieron leer los interruptores">
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
        <Tarjeta titulo="Agente 5: escribirle a los choferes">
          <p>
            <StatusChip tono={agenteChofer.habilitado ? 'ok' : agenteChofer.razon === 'compuerta_ilegible' ? 'bad' : 'neutral'}>
              {agenteChofer.habilitado ? 'Habilitado' : agenteChofer.razon === 'compuerta_ilegible' ? 'No se pudo leer (se trata como apagado)' : 'Apagado'}
            </StatusChip>{' '}
            Mientras esté apagado, el agente no le escribe a ningún chofer de esta flota. Habilitarlo no salta las demás compuertas.
          </p>
          <FormaConAviso
            accion={accionAgenteChofer} boton={agenteChofer.habilitado ? 'Deshabilitar el Agente 5' : 'Habilitar el Agente 5'} columnas="md:grid-cols-1"
            confirmar={agenteChofer.habilitado ? undefined : {
              titulo: 'Habilitar el Agente 5 para esta flota',
              descripcion: 'Desde ahora el agente puede escribirle por WhatsApp a los choferes voluntarios de esta flota. Queda firmado en la bitácora con tu nombre y el motivo.',
              etiquetaConfirmar: 'Sí, habilitar',
            }}
          >
            <input type="hidden" name="operacion" value={agenteChofer.habilitado ? 'deshabilitar' : 'habilitar'} />
            <CampoTexto etiqueta="Motivo (queda en la bitácora)" name="motivo" required ayuda="Ej.: piloto autorizado por el dueño, cohorte definida." />
          </FormaConAviso>
        </Tarjeta>
      )}
    </>
  );

  const activas = (personas ?? []).filter((p) => p.activa).length;
  const baja = (
    <Tarjeta titulo="Baja de la flota">
      <p>
        {personas === null || personas === undefined
          ? 'No se pudo leer el equipo de la flota.'
          : `${numero(activas)} ${activas === 1 ? 'persona activa' : 'personas activas'} de ${numero(personas.length)}.`}
      </p>
      <p>
        Hoy la baja se hace persona por persona desde Equipo, con confirmación y bitácora. Suspender la flota completa en un paso y
        exportar sus datos (constancia de salida) todavía no existen en esta pantalla: quedan pendientes de la decisión del dueño sobre
        la exportación.
      </p>
      <BotonEnlace href={`/admin/equipo?flota=${id}`} variante="secondary">Gestionar personas de la flota</BotonEnlace>
    </Tarjeta>
  );

  return (
    <SeccionesFicha
      inicial={seccionInicial}
      secciones={[
        { valor: 'resumen', etiqueta: 'Resumen', contenido: resumen },
        { valor: 'equipo', etiqueta: 'Equipo', contenido: equipo },
        { valor: 'plan', etiqueta: 'Plan y cobro', contenido: plan },
        { valor: 'arranque', etiqueta: 'Arranque y fiscal', contenido: arranqueSec },
        { valor: 'controles', etiqueta: 'Controles', contenido: controles },
        { valor: 'baja', etiqueta: 'Baja', contenido: baja },
      ]}
    />
  );
}

/** El encabezado de la ficha (lo monta `page.tsx` dentro del ÚNICO `MarcoPagina` de la ruta, también cuando la lectura falla). */
export function encabezadoFicha(f: FichaCliente) {
  return {
    titulo: f.tenant.nombre,
    apoyo: `Plan ${f.tenant.plan}${f.tenant.creadoEn ? `, alta ${fechaCorta(f.tenant.creadoEn)}` : ''}.`,
    acciones: (
      <>
        <BotonEnlace href="/admin/flotas" variante="ghost">Volver a Clientes</BotonEnlace>
        <BotonEnlace href={`/dashboard?tenant=${f.tenant.id}&rol=flota_admin`} variante="secondary">Ver su panel</BotonEnlace>
      </>
    ),
  };
}
