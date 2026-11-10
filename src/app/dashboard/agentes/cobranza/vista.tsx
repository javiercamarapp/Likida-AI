import { Inbox } from 'lucide-react';
import type { ColaCobranza, ContactoBitacora, FilaCola } from '@/lib/likida/agentes/cobranza';
import type { ConfigCobranza } from '@/lib/likida/agentes/cobranza_pura';
import { numero, fechaCorta } from '@/lib/formato';
import { BotonEjecutar, BotonPausa, type AccionSimple, type AccionEjecutar } from './controles';
import { FormaEstrategia } from './estrategia';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Disclosure, EstadoVacio, FilaTarjetas, MarcoPagina, StatusChip, Tarjeta, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import '../agentes.css';

export interface ExtraAgenteCobranza {
  /** ¿AHORA MISMO está dentro de su ventana de contacto? (calculado en el
   *  servidor con la hora de México, no la del navegador). */
  enVentana: boolean;
  /** El siguiente REAL de la cola (folio + días JUNTOS: un folio verdadero
   *  con días que no son los suyos contradiría la tabla de arriba). null =
   *  cola vacía; la vista previa se declara plantilla. */
  ejemplo: { folio: string | null; dias: number } | null;
}

/** Los días ISO como los lee un humano de tráfico. */
const DIA_CORTO = ['', 'L', 'M', 'X', 'J', 'V', 'S', 'D'];
function rotuloDias(dias: number[]): string {
  // Contiguos → rango ("L–S"); salteados → lista ("L, X, V").
  const contiguos = dias.every((d, i) => i === 0 || d === dias[i - 1] + 1);
  if (contiguos && dias.length > 2) return `${DIA_CORTO[dias[0]]}–${DIA_CORTO[dias[dias.length - 1]]}`;
  return dias.map((d) => DIA_CORTO[d]).join(', ');
}

/**
 * El render del Agente de Cobranza (Fase 1 del plan). Tres zonas: la
 * cola honesta (a quién va a insistir Y a quién no puede,
 * con el porqué), la bitácora de lo que ya hizo, y la estrategia que el
 * cliente edita con la vista previa del mensaje real.
 *
 * AQUÍ NO HAY PESOS A PROPÓSITO: este agente cobra COMPROBANTES, no dinero.
 * Sus cifras son días y contactos, todas medidas.
 */
export function VistaAgenteCobranza({
  cola, config, bitacora, extra, acciones, notificaciones, porGasto, gastosParaContactar = 0,
}: {
  cola: ColaCobranza;
  config: ConfigCobranza;
  bitacora: ContactoBitacora[] | null;
  extra: ExtraAgenteCobranza;
  acciones: { guardarEstrategia: AccionSimple; alternarPausa: AccionSimple; ejecutarAhora: AccionEjecutar };
  /** La sección de Notificaciones, ya renderizada en el servidor
   *  (`SeccionNotificaciones`). Entra como ReactNode y no como datos: esta
   *  vista no debe importar el motor de avisos, que trae `supabaseAdmin`. */
  notificaciones?: React.ReactNode;
  /** La sección de cobranza POR GASTO (0525), ya renderizada en el servidor. */
  porGasto?: React.ReactNode;
  /** Choferes con gastos en tier hoy: «Ejecutar ahora» también los cubre. */
  gastosParaContactar?: number;
}) {
  const ventana = `${rotuloDias(config.diasSemana)} · ${config.horaInicio}–${config.horaFin} h`;

  return (
    <MarcoPagina titulo="Seguimiento de comprobantes" apoyo="A quién insistirá el agente por comprobantes y a quién no puede, con el porqué. Cobra comprobantes, no dinero.">

      <TiraCifras sello={selloHoy('Cola de seguimiento')}>
        <Cifra info="cobranza.para_contactar" etiqueta="Para contactar" valor={numero(cola.paraContactar.length)}
          nota="alcanzaron un tier sin contacto" />
        <Cifra info="cobranza.no_puede_contactar" etiqueta="No puede contactar" valor={numero(cola.sinTelefono.length)}
          nota="sin teléfono capturado" tono={cola.sinTelefono.length > 0 ? 'warn' : undefined} />
        <Cifra info="cobranza.viajes_vigilados" etiqueta="Viajes vigilados" valor={numero(cola.vigilados)} nota="abiertos o en cuadre" />
        <Cifra info="cobranza.estado" etiqueta="Estado" valor={config.activo ? 'Activo' : 'Pausado'} nota={ventana}
          tono={config.activo ? undefined : 'warn'} />
      </TiraCifras>

      <FilaTarjetas variante="8-4">
        {/* ── La cola honesta ── */}
        <Tarjeta
          titulo="Los va a contactar"
          info="cobranza.cola"
          acciones={
            <BotonEjecutar
              ejecutarAhora={acciones.ejecutarAhora}
              enCola={cola.paraContactar.length + gastosParaContactar}
              activo={config.activo}
            />
          }
        >
          <p className="rv-ag-notif__nota">
            {!config.activo
              ? 'El agente está pausado: no contacta a nadie, ni con Ejecutar ahora.'
              : extra.enVentana
                ? 'Dentro de la ventana — la próxima corrida de la hora los contacta sola.'
                : `Fuera de la ventana (${ventana}) — los contacta cuando abra, o ahora si tú se lo pides.`}
          </p>
          {cola.paraContactar.length === 0 ? (
            <EstadoVacio titulo="Nadie con comprobantes atrasados" icono={Inbox} contenido>
              Nadie trae comprobantes atrasados a los tiers de hoy — cuando un viaje cruce los {config.tiers[0]} días sin comprobar, aparece aquí antes de que el agente le escriba.
            </EstadoVacio>
          ) : (
            <TablaBase etiqueta="Viajes en cobranza con su operador" columnas={COLUMNAS_COLA} filas={cola.paraContactar} idFila={(f) => f.viajeId} densa tarjetaMovil />
          )}
        </Tarjeta>

        {/* A quién NO puede — la mitad honesta de la cola */}
        <Tarjeta
          titulo="A quién no puede escribirle"
          info="cobranza.sin_telefono"
          estado={cola.sinTelefono.length === 0 ? 'vacio' : 'ok'}
          mensaje="Todos tienen teléfono"
          detalle="Todos los operadores con viajes atrasados tienen teléfono — el agente no trae las manos atadas con nadie."
        >
          <p className="rv-ag-notif__nota">Alcanzaron un tier, pero el operador no tiene teléfono capturado</p>
          <ul className="rv-ag-notif__personas">
            {cola.sinTelefono.map((f) => (
              <li key={f.viajeId}>
                <StatusChip tono="warn">Sin teléfono</StatusChip>
                <strong>{f.folio ?? 'Sin folio'}</strong>
                <span>{f.operadorNombre ?? 'Operador sin nombre'}</span>
                <em>{numero(f.dias)} días</em>
              </li>
            ))}
          </ul>
        </Tarjeta>
      </FilaTarjetas>

      {/* Bitácora — lo que ya hizo, con sus fallos a la vista */}
      <Tarjeta
        titulo="Bitácora de contactos"
        info="cobranza.bitacora"
        estado={bitacora === null ? 'error' : bitacora.length === 0 ? 'vacio' : 'ok'}
        mensaje={bitacora === null ? 'No se pudo leer la bitácora ahora mismo.' : 'Aún sin contactos'}
        detalle="Cada intento del agente queda escrito aquí, incluidos los que no salieron y su porqué."
      >
        <p className="rv-ag-notif__nota">Los últimos intentos, salieran o no</p>
        <TablaBase
          etiqueta="Bitácora de contactos"
          columnas={COLUMNAS_BITACORA}
          filas={bitacora ?? []}
          idFila={(c) => `${c.cuando}-${c.folio ?? ''}-${c.operadorNombre ?? ''}`}
          densa
          tarjetaMovil
        />
      </Tarjeta>

      {porGasto}

      {/* ── La estrategia del cliente, con vista previa (las "Pruebas") ── */}
      <Tarjeta titulo="Su estrategia" info="cobranza.estrategia" acciones={<BotonPausa alternarPausa={acciones.alternarPausa} activo={config.activo} />}>
        <p className="rv-ag-notif__nota">Cuándo insiste, en qué horario y con qué palabras — la vista previa es el mensaje literal</p>
        <Disclosure titulo="Editar la estrategia" resumen={ventana} abierto>
          <FormaEstrategia
            config={config}
            ejemplo={extra.ejemplo}
            guardar={acciones.guardarEstrategia}
          />
        </Disclosure>
      </Tarjeta>

      {notificaciones}
    </MarcoPagina>
  );
}

const COLUMNAS_COLA: readonly ColumnaBase<FilaCola>[] = [
  { id: 'viaje', titulo: 'Viaje', principal: true, celda: (f) => f.folio ?? 'Sin folio' },
  { id: 'operador', titulo: 'Operador', celda: (f) => f.operadorNombre ?? 'Sin nombre' },
  { id: 'dias', titulo: 'Sin comprobar', alinear: 'der', celda: (f) => `${numero(f.dias)} días` },
  { id: 'tier', titulo: 'Tier que toca', alinear: 'der', celda: (f) => <StatusChip tono="warn">{f.tier} días</StatusChip> },
  { id: 'previos', titulo: 'Contactos previos', alinear: 'der', celda: (f) => numero(f.contactosPrevios) },
];

const COLUMNAS_BITACORA: readonly ColumnaBase<ContactoBitacora>[] = [
  { id: 'cuando', titulo: 'Fecha', principal: true, celda: (c) => fechaCorta(c.cuando) },
  { id: 'estado', titulo: 'Resultado', celda: (c) => (c.enviado ? <StatusChip tono="ok">Enviado</StatusChip> : <StatusChip tono="bad">No salió</StatusChip>) },
  {
    id: 'detalle', titulo: 'Qué pasó',
    celda: (c) => c.enviado
      ? <span>Le insistió a <strong>{c.operadorNombre ?? 'el operador'}</strong> por el viaje <strong>{c.folio ?? 'sin folio'}</strong> (tier de {c.tier} días)</span>
      : <span>No le pudo escribir a <strong>{c.operadorNombre ?? 'el operador'}</strong> por el viaje <strong>{c.folio ?? 'sin folio'}</strong>{c.detalle ? ` — ${c.detalle}` : ''}</span>,
  },
];
