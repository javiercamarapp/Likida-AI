import Link from 'next/link';
import { ScrollText, TriangleAlert, Mail, MessageCircle, LayoutDashboard, Inbox, CheckCircle2 } from 'lucide-react';
import './carta-porte.css';
import type { EstadoCartaPorte } from '@/lib/likida/carta_porte_datos';
import { numero } from '@/lib/formato';
import type { InsightsAgente, CalidadGrupo, TarjetaInsight } from '@/lib/likida/carta_porte_docs/metricas';
import { aCsvSinCcp, type ListadoSinCcp, type ColorAntiguedad } from '@/lib/likida/carta_porte_docs/viajes_sin_ccp';
import { estadoCatalogosSat, type ConteoCatalogosSat } from '@/lib/likida/carta_porte_docs/catalogos_sat';
import { DireccionBuzon } from '../proveedores/controles';
import { AVISO_SIN_REMITENTES } from '@/lib/correo/remitente';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { BarList, Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import {
  Aviso, AvisoCompacto, clasesBoton, Disclosure, EstadoError, EstadoVacio, FilaTarjetas, Icono, MarcoPagina, StatusChip, TablaBase, Tarjeta,
  type ColumnaBase, type TonoEstado,
} from '@/app/ui-v2/componentes';

/**
 * La ventana del Agente de Carta Porte (Fases B-C del blueprint): los conteos
 * del semáforo, la COLA de «falta declarar» (los viajes donde el agente está
 * esperando una respuesta del jefe), y la carta de lo que entiende — que es
 * la verdad del código, no marketing.
 *
 * Área `operacion` como su pantalla hermana /dashboard/carta-porte: cero
 * pesos, y su usuario diario es el jefe de tráfico. Pura props.
 */
/** El buzón de correo de la flota tal como lo pinta el bloque «Cómo mandarme documentos». */
export interface BuzonCartaPorteVista { direccion: string | null; activo: boolean; remitentes: string[]; dominioConfigurado: boolean }

/**
 * La frase que dice que los grupos NO son un canal. Exportada para que la prueba
 * la distinga de cualquier otra mención: «grupo» solo puede aparecer aquí.
 */
export const FRASE_SIN_GRUPOS = 'Los grupos de WhatsApp no se pueden leer: pide a tus clientes que escriban al correo o reenvíalos tú.';

type ViajeEnCola = EstadoCartaPorte['viajes'][number];

const COLUMNAS_COLA: readonly ColumnaBase<ViajeEnCola>[] = [
  { id: 'folio', titulo: 'Viaje', principal: true, celda: (v) => <span className="cifra-mono">{v.folio ?? v.viajeId.slice(0, 8)}</span> },
  { id: 'ruta', titulo: 'Ruta', celda: (v) => (v.origen && v.destino ? `${v.origen} → ${v.destino}` : 'sin ruta capturada') },
  {
    id: 'falta', titulo: 'Lo que falta declarar',
    celda: (v) => (
      <span className="rv-cp__pendientes">
        <Icono icono={TriangleAlert} tam={14} />
        {v.decision.pendientes.join(' · ')}
      </span>
    ),
  },
];

export function VistaAgenteCartaPorte({ datos, sufijo = '', notificaciones, buzon = null, insights, sinCcp, nombresCliente = {}, diasVentana = 30, catalogosSat }: {
  datos: EstadoCartaPorte | null;
  sufijo?: string;
  notificaciones?: React.ReactNode;
  /** `null` = la flota aún no activa su buzón; `'no_leido'` = la lectura falló (no se finge «sin buzón»). */
  buzon?: BuzonCartaPorteVista | null | 'no_leido';
  /** T-A3-37. `undefined` = no se pide el bloque; `'no_leido'` = la lectura falló (no se finge «sin datos»). */
  insights?: InsightsAgente | 'no_leido';
  /** T-A3-66. `undefined` = no se pide el bloque; `'no_leido'` = la lectura falló (no se finge «sin pendientes»). */
  sinCcp?: ListadoSinCcp | 'no_leido';
  /** id de cliente → nombre, solo para rotular. */
  nombresCliente?: Record<string, string>;
  diasVentana?: number;
  /** CT-A345-04: filas cargadas por catálogo SAT. `undefined` = no se pide el aviso; `'no_leido'` = la lectura falló (no se finge «cargados»). */
  catalogosSat?: ConteoCatalogosSat | 'no_leido';
}) {
  const conteo = (n: 'si' | 'no' | 'falta_declarar') =>
    datos === null ? null : datos.viajes.filter((v) => v.decision.necesita === n).length;
  const armables = datos === null ? null : datos.viajes.filter((v) => v.borrador.borrador !== null && v.borrador.fallas.length === 0).length;
  const cola = datos === null ? [] : datos.viajes.filter((v) => v.decision.necesita === 'falta_declarar');
  const esperan = conteo('falta_declarar');

  return (
    <MarcoPagina titulo="Carta Porte en automático" apoyo="Al despachar corre el árbol legal y pregunta por WhatsApp lo que falta declarar. Prepara y valida; nunca timbra.">

      <AvisoCompacto
        tono="info"
        resumen="Al despachar un viaje, el agente pregunta por WhatsApp lo que falta declarar. Prepara el borrador y lo valida; nunca timbra."
        mas="Corre el árbol legal (RMF 2.7.7) y le pregunta al jefe exactamente lo que falta declarar — o le da el veredicto con fundamento. Nunca afirma «no necesitas» por su cuenta, nunca inventa un dato del complemento y nunca timbra: prepara el borrador y lo valida contra lo que el PAC rechazaría seguro."
      />

      {catalogosSat !== undefined && <AvisoCatalogosSat catalogosSat={catalogosSat} />}

      {datos === null ? (
        <EstadoError>No se pudieron leer los viajes en curso. Sin lectura no se pintan conteos: un cero fingido aquí diría «todo en regla».</EstadoError>
      ) : (
        <>
          <TiraCifras sello={selloHoy('Viajes en curso')}>
            <Cifra info="carta_porte_agente.en_curso" etiqueta="Viajes en curso" valor={numero(datos.total)} />
            <Cifra info="carta_porte_agente.esperan" etiqueta="Esperan declaración" valor={esperan === null ? null : numero(esperan)} tono={esperan !== null && esperan > 0 ? 'bad' : undefined} />
            <Cifra info="carta_porte_agente.necesitan" etiqueta="Necesitan complemento" valor={conteo('si') === null ? null : numero(conteo('si') as number)} tono={(conteo('si') ?? 0) > 0 ? 'warn' : undefined} />
            <Cifra info="carta_porte_agente.borradores" etiqueta="Borradores sin fallas" valor={armables === null ? null : numero(armables)} />
          </TiraCifras>

          <Tarjeta titulo="Esperando al jefe" info="carta_porte_agente.cola"
            estado={cola.length === 0 ? 'vacio' : 'ok'} iconoVacio={ScrollText} mensaje="Nada pendiente de declarar"
            detalle="Cada viaje en curso ya tiene su veredicto (o no hay viajes). Al despachar uno nuevo, el agente pregunta solo."
            acciones={<Link href={`/dashboard/carta-porte${sufijo}`} className={clasesBoton('secondary', 'sm')}>Declarar y capturar</Link>}>
            <TablaBase etiqueta="Viajes esperando una declaración" columnas={COLUMNAS_COLA} filas={cola} idFila={(v) => v.viajeId} densa tarjetaMovil />
            {datos.viajes.length < datos.total && (
              <p className="rv-cp__nota" data-tono="faint">
                Los conteos por veredicto salen de los {numero(datos.viajes.length)} viajes más
                próximos de {numero(datos.total)} en curso.
              </p>
            )}
          </Tarjeta>
        </>
      )}

      <ComoMandarDocumentos buzon={buzon} sufijo={sufijo} />

      {sinCcp !== undefined && <ViajesSinCcp listado={sinCcp} />}

      {insights !== undefined && <InsightsDelAgente insights={insights} nombresCliente={nombresCliente} diasVentana={diasVentana} />}

      <p className="rv-cp__nota">
        Lo que el agente aprende de cada cliente —productos, remitentes, destinatarios y su número interno— vive en el{' '}
        <Link href={`/dashboard/agentes/carta-porte/catalogo${sufijo}`} className="rv-cp__enlace">catálogo del cliente</Link>.
      </p>
      <p className="rv-cp__nota">
        Los clientes que necesitan su referencia para cobrar, y los viajes cargados que aún no la traen:{' '}
        <Link href={`/dashboard/agentes/carta-porte/referencia${sufijo}`} className="rv-cp__enlace">referencia del cliente</Link>.
      </p>

      <Tarjeta titulo="Lo que hace, y lo que jamás hará" info="carta_porte_agente.alcance">
        <Disclosure titulo="Alcance del agente" resumen="Al despachar · Con lo capturado · Jamás" abierto variante="linea">
          <div className="rv-cp__tres">
            <div className="rv-cp__col">
              <p className="rv-cp__rotulo">Al despachar</p>
              <p className="rv-cp__nota">
                Corre el árbol legal y pregunta por WhatsApp: «¿la ruta pisa carretera federal?» con
                botones, y si la unidad cabe en la excepción del C2, el radio («radio F-123 25»).
                Cada declaración queda firmada con quién y cuándo.
              </p>
            </div>
            <div className="rv-cp__col">
              <p className="rv-cp__rotulo">Con lo capturado</p>
              <p className="rv-cp__nota">
                Arma el borrador del complemento (37 datos, partidos 19 del cliente / 18 del
                transportista) y lo pasa por las validaciones que el PAC rechaza seguro — «te faltó
                esto, antes de salir» en vez de «rebotó el timbrado con el viaje entregado».
              </p>
            </div>
            <div className="rv-cp__col">
              <p className="rv-cp__rotulo">Jamás</p>
              <p className="rv-cp__nota">
                No afirma «no necesitas Carta Porte» sin tu declaración firmada; no inventa claves del
                SAT ni el número de permiso SICT (faltante = faltante); y no timbra — el CFDI lo emite
                tu PAC de siempre.
              </p>
            </div>
          </div>
        </Disclosure>
      </Tarjeta>

      {notificaciones}
    </MarcoPagina>
  );
}

/**
 * Los tres caminos por los que llega un documento (el correo oficial del cliente
 * es el principal; el WhatsApp es 1:1 con la oficina, nunca un grupo) y, con el
 * buzón sin activar, el estado vacío que dice cómo empezar.
 */
function ComoMandarDocumentos({ buzon, sufijo }: { buzon: BuzonCartaPorteVista | null | 'no_leido'; sufijo: string }) {
  const panel = `/dashboard/carta-porte/documentos${sufijo}`;
  return (
    <Tarjeta titulo="Cómo mandarme documentos" info="carta_porte_agente.como_mandar">
      <div className="rv-cp__pila">
        <div className="rv-cp__tres">
          <div className="rv-cp__col">
            <p className="rv-cp__rotulo"><Icono icono={Mail} tam={14} /> 1 · Correo (el medio oficial)</p>
            {buzon === 'no_leido' ? (
              <EstadoError compacto>No se pudo leer el buzón de tu flota. Sin lectura no se enseña una dirección: una inventada se perdería.</EstadoError>
            ) : buzon === null ? (
              <EstadoVacio titulo="Aún no tienes buzón" icono={Inbox} contenido>
                Actívalo en el panel de documentos y aquí verás la dirección para
                que tus clientes (o tú) reenvíen los embarques.
              </EstadoVacio>
            ) : buzon.direccion ? (
              <>
                <DireccionBuzon direccion={buzon.direccion} />
                {!buzon.activo && <p className="rv-cp__nota" data-tono="warn">El buzón está apagado: lo que llegue no se leerá hasta encenderlo en el panel.</p>}
                <p className="rv-cp__nota">
                  Los adjuntos (PDF, Excel, XML, foto) y el texto del correo entran solos a la bandeja.
                </p>
                <p className="rv-cp__nota">
                  {buzon.remitentes.length > 0
                    ? `Remitentes de tus clientes reconocidos: ${buzon.remitentes.join(', ')}. Uno distinto entra igual, marcado «remitente no reconocido».`
                    : AVISO_SIN_REMITENTES}
                </p>
              </>
            ) : (
              <p className="rv-cp__nota" data-tono="warn">
                {buzon.dominioConfigurado ? 'La dirección no se pudo armar.' : 'El dominio de correo de Likida no está configurado en este entorno: el buzón existe pero no hay dirección que dar.'}
              </p>
            )}
          </div>
          <div className="rv-cp__col">
            <p className="rv-cp__rotulo"><Icono icono={MessageCircle} tam={14} /> 2 · WhatsApp 1:1 de la oficina</p>
            <p className="rv-cp__nota">
              Quien despacha reenvía el archivo al número de Likida, o pega el texto del embarque empezando
              con la palabra «carta porte». Una foto debe llevar ese mismo pie.
            </p>
          </div>
          <div className="rv-cp__col">
            <p className="rv-cp__rotulo"><Icono icono={LayoutDashboard} tam={14} /> 3 · El panel</p>
            <p className="rv-cp__nota">Sube el archivo a mano en la bandeja de documentos.</p>
            <Link href={panel} className="rv-cp__enlace">Abrir la bandeja de documentos</Link>
          </div>
        </div>
        <p className="rv-cp__frase">{FRASE_SIN_GRUPOS}</p>
      </div>
    </Tarjeta>
  );
}

const pctTxt = (p: number | null): string => (p === null ? '—' : `${p} %`);
const TONO_INSIGHT: Record<TarjetaInsight['tono'], string> = { bad: 'bad', warn: 'warn', info: 'info' };

function TarjetaQuePaso({ t }: { t: TarjetaInsight }) {
  return (
    <div className="rv-cp__quepaso" data-tono={TONO_INSIGHT[t.tono]}>
      <p><strong>{t.quePaso}</strong></p>
      <p className="rv-cp__nota"><b>Qué significa </b>{t.queSignifica}</p>
      <p><b>Qué hacer </b>{t.queHacer}</p>
    </div>
  );
}

/** Calidad por grupo: una lista de barras con el % sin tocar y el texto exacto («% (n)») — reemplaza la tabla a mano. */
function CalidadPorGrupo({ titulo, filas, rotular }: { titulo: string; filas: CalidadGrupo[]; rotular: (clave: string) => string }) {
  const columnas: readonly ColumnaBase<CalidadGrupo>[] = [
    { id: 'grupo', titulo: 'Grupo', principal: true, celda: (g) => rotular(g.clave) },
    { id: 'aprobados', titulo: 'Aprobados', alinear: 'der', celda: (g) => numero(g.documentos) },
    { id: 'sintocar', titulo: 'Sin tocar', alinear: 'der', celda: (g) => `${pctTxt(g.pctSinTocar)} (${numero(g.sinTocar)})` },
  ];
  return (
    <Tarjeta titulo={titulo} estado={filas.length === 0 ? 'vacio' : 'ok'} mensaje="Sin documentos aprobados todavía" detalle="Cuando se aprueben documentos, aquí verás cuántos pasaron sin tocar.">
      {filas.length > 0 && (
        <>
          <BarList etiqueta={`${titulo}: porcentaje sin tocar`} formato={(v) => `${v} %`}
            items={filas.slice(0, 5).map((g) => ({ clave: g.clave, etiqueta: rotular(g.clave), valor: g.pctSinTocar, texto: `${pctTxt(g.pctSinTocar)} (${numero(g.sinTocar)} de ${numero(g.documentos)})` }))} maximo={100} />
          <Disclosure titulo="Ver la tabla" variante="linea">
            <TablaBase etiqueta={titulo} columnas={columnas} filas={filas} idFila={(g) => g.clave} densa tarjetaMovil />
          </Disclosure>
        </>
      )}
    </Tarjeta>
  );
}

/**
 * Cómo le va al agente (T-A3-37): % sin tocar, causas de rechazo, calidad por formato y cliente y estado de los
 * envíos. Solo conteos: ningún valor de un documento. Sin base, dice «—», nunca un 0 % que parezca medición.
 */
function InsightsDelAgente({ insights, nombresCliente, diasVentana }: { insights: InsightsAgente | 'no_leido'; nombresCliente: Record<string, string>; diasVentana: number }) {
  const titulo = `Cómo le va al agente · últimos ${diasVentana} días`;
  if (insights === 'no_leido') {
    return <Tarjeta titulo={titulo} info="carta_porte_agente.resultados" estado="error" mensaje="No se pudieron leer los resultados del agente. Vuelve a intentar en un momento." reintentar />;
  }
  const i = insights;
  const nombre = (c: string) => (c === 'sin_cliente' ? 'Sin cliente asignado' : nombresCliente[c] ?? 'Cliente sin nombre');
  const e = i.envios;
  const hayAlgo = i.aprobados > 0 || e.enviados + e.rechazadosTms + e.pendientesReque + e.subidosAMano > 0 || (i.causasRechazo?.length ?? 0) > 0;
  return (
    <Tarjeta titulo={titulo} info="carta_porte_agente.resultados" estado={hayAlgo ? 'ok' : 'vacio'} mensaje="Todavía no hay resultados que medir"
      detalle="Cuando se aprueben documentos y salgan envíos, aquí verás cuántos pasaron sin tocar, por qué se rechazaron y qué falta enviar.">
      <div className="rv-cp__pila">
        {i.parcial && (
          <p className="rv-cp__nota" data-tono="warn" role="note">
            Cifras de los {numero(i.parcial.leidos)} documentos más recientes de {numero(i.parcial.total)} de los últimos {diasVentana} días: son parciales.
          </p>
        )}
        <TiraCifras sello={selloHoy('Documentos de Carta Porte')}>
          <Cifra info="carta_porte_agente.sin_tocar" etiqueta="Aprobados sin tocar" valor={pctTxt(i.pctSinTocar)} nota={i.aprobados === 0 ? 'Aún no hay aprobados' : `de ${numero(i.aprobados)} aprobados`} />
          <Cifra info="carta_porte_agente.enviados" etiqueta="Enviados al sistema del cliente" valor={numero(e.enviados)} />
          <Cifra info="carta_porte_agente.esperan_requerimiento" etiqueta="Esperan requerimiento" valor={numero(e.pendientesReque)} tono={e.pendientesReque > 0 ? 'warn' : undefined} />
          <Cifra info="carta_porte_agente.rechazados_tms" etiqueta="Rechazados por el sistema del cliente" valor={numero(e.rechazadosTms)} tono={e.rechazadosTms > 0 ? 'bad' : undefined} />
        </TiraCifras>
        <p className="rv-cp__nota">
          Tiempo típico de aprobado a enviado: {e.medianaAprobadoAEnviadoMin === null ? '— (aún no hay envíos medibles)' : `${e.medianaAprobadoAEnviadoMin} min (mediana)`}.
          {e.pendienteMasViejoHoras !== null && ` El que más espera lleva ${e.pendienteMasViejoHoras} h.`}
        </p>
        {i.tarjetas.length > 0 && <div className="rv-cp__dos">{i.tarjetas.map((t) => <TarjetaQuePaso key={t.id} t={t} />)}</div>}
        <FilaTarjetas variante="6-6">
          <CalidadPorGrupo titulo="Calidad por formato" filas={i.porFormato} rotular={(c) => c} />
          <CalidadPorGrupo titulo="Calidad por cliente" filas={i.porCliente} rotular={nombre} />
        </FilaTarjetas>
        <FilaTarjetas variante="6-6">
          <Tarjeta titulo="Por qué se rechazan">
            {i.causasRechazo === null ? <p className="rv-cp__nota">No disponible todavía en esta base.</p>
              : i.causasRechazo.length === 0 && i.rechazadosSinCausa === 0 ? <p className="rv-cp__nota">No hubo rechazos.</p>
              : <ul className="rv-cp__lista">
                  {i.causasRechazo.map((c) => <li key={c.causa}>{c.rotulo}: <span className="cifra-mono">{numero(c.documentos)}</span></li>)}
                  {(i.rechazadosSinCausa ?? 0) > 0 && <li>Sin clasificar: <span className="cifra-mono">{numero(i.rechazadosSinCausa ?? 0)}</span></li>}
                </ul>}
          </Tarjeta>
          <Tarjeta titulo="Lo que más se corrige">
            {i.topCamposCorregidos.length === 0 ? <p className="rv-cp__nota">Nadie ha corregido campos en este periodo.</p>
              : <ol className="rv-cp__lista rv-cp__lista--num">{i.topCamposCorregidos.map((c) => <li key={c.campo}>{c.campo}: <span className="cifra-mono">{numero(c.correcciones)}</span> {c.correcciones === 1 ? 'vez' : 'veces'}</li>)}</ol>}
          </Tarjeta>
        </FilaTarjetas>
      </div>
    </Tarjeta>
  );
}

const TONO_ANTIGUEDAD: Record<ColorAntiguedad, TonoEstado> = { verde: 'ok', ambar: 'warn', rojo: 'bad' };
const ROTULO_ANTIGUEDAD: Record<ColorAntiguedad, string> = { verde: 'Reciente', ambar: 'Atención', rojo: 'Riesgo de multa' };

interface FilaSinCcp { clave: string; cliente: string; folio: string; horas: number; dias: number; color: ColorAntiguedad }

const COLUMNAS_SIN_CCP: readonly ColumnaBase<FilaSinCcp>[] = [
  { id: 'cliente', titulo: 'Cliente', principal: true, celda: (f) => f.cliente },
  { id: 'folio', titulo: 'Viaje', celda: (f) => f.folio },
  { id: 'horas', titulo: 'Sin Carta Porte', alinear: 'der', celda: (f) => <span className="cifra-mono">{numero(f.horas)} h ({numero(f.dias)} d)</span> },
  { id: 'estado', titulo: 'Antigüedad', celda: (f) => <StatusChip tono={TONO_ANTIGUEDAD[f.color]}>{ROTULO_ANTIGUEDAD[f.color]}</StatusChip> },
];

/**
 * T-A3-66 — viajes que ya salieron y siguen sin Carta Porte, por cliente y con su antigüedad. SOLO LECTURA: no envía
 * mensajes ni cierra viajes. El reporte semanal es un CSV que se baja desde aquí.
 */
function ViajesSinCcp({ listado }: { listado: ListadoSinCcp | 'no_leido' }) {
  if (listado === 'no_leido') {
    return <Tarjeta titulo="Viajes salidos sin Carta Porte" info="carta_porte_agente.sin_ccp" estado="error" mensaje="No se pudo leer la lista de viajes salidos sin Carta Porte. Vuelve a intentar en un momento." reintentar />;
  }
  // A3-01 (cierre100): null no es 0. Sin ningún viaje importado del TMS no se puede decir que no haya viajes sin Carta Porte:
  // ni cifra ni estado vacío verde, ni descarga.
  if (listado.sinDatosTms?.motivo === 'sin_viajes') {
    return (
      <Tarjeta titulo="Viajes salidos sin Carta Porte" info="carta_porte_agente.sin_ccp">
        <Aviso tono="warn">
          <strong>Sin datos del TMS:</strong> no se puede decir si hay viajes salidos sin Carta Porte. No hay ningún viaje importado del sistema de transporte en los últimos días
          {listado.sinDatosTms.ultimoImportadoEn ? ` (el último que entró fue hace ${numero(listado.sinDatosTms.horasDesdeImportacion ?? 0)} h)` : ''}.
          Esto no significa que todo tenga Carta Porte.
        </Aviso>
      </Tarjeta>
    );
  }
  const ligados = listado.ligadosPorFolio;
  // A3-02: si casi nada liga por folio, el supuesto «folio del TMS = folio del cliente» probablemente es falso y TODO saldría «sin CCP».
  const pocoLigado = !!ligados && ligados.total >= 10 && ligados.ligados / ligados.total < 0.05;
  const filas: FilaSinCcp[] = listado.grupos.flatMap((g) =>
    g.viajes.map((v) => ({
      clave: `${g.clienteId ?? 'sin_cliente'}-${v.viajeId}`,
      cliente: g.clienteNombre,
      folio: `${v.folio ?? 'Sin folio'}${v.localAbierto ? ' · local abierto' : ''}`,
      horas: v.horas, dias: v.dias, color: v.color,
    })));
  const sinTabla = listado.vacio && (listado.truncado || !!listado.sinDatosTms);
  return (
    <Tarjeta titulo={`Viajes salidos sin Carta Porte · ${numero(listado.total)}`} info="carta_porte_agente.sin_ccp"
      estado={listado.vacio && !sinTabla ? 'vacio' : 'ok'} iconoVacio={CheckCircle2} mensaje="No hay viajes salidos sin Carta Porte"
      detalle="Cuando salga uno sin complemento aparecerá aquí con las horas que lleva sin él."
      acciones={!listado.vacio ? (
        <a download="viajes-sin-carta-porte.csv" href={`data:text/csv;charset=utf-8,${encodeURIComponent(aCsvSinCcp(listado))}`} className={clasesBoton('secondary', 'sm')}>
          Descargar reporte (CSV)
        </a>
      ) : undefined}>
      <div className="rv-cp__pila">
        {listado.sinDatosTms?.motivo === 'importacion_vieja' && (
          <Aviso tono="warn">
            La última importación de viajes del TMS fue hace {numero(listado.sinDatosTms.horasDesdeImportacion ?? 0)} h: esta lista puede estar atrasada y no debe leerse como «todo en regla».
          </Aviso>
        )}
        {ligados && (
          <p className="rv-cp__nota">
            {numero(ligados.ligados)} de {numero(ligados.total)} viajes ligados a un documento por folio (cliente + folio).
          </p>
        )}
        {pocoLigado && (
          <Aviso tono="warn">
            Casi ningún viaje liga con un documento por folio: es posible que el folio del TMS no sea el mismo número que el folio del cliente. Confírmalo antes de leer esta lista como riesgo de multa.
          </Aviso>
        )}
        {listado.truncado && (
          <Aviso tono="warn">
            La lista está incompleta: hay más salidas de las que se pueden leer de una vez y faltan las más antiguas. Revisa los viajes viejos en Viajes.
          </Aviso>
        )}
        {!listado.vacio && <TablaBase etiqueta="Viajes salidos sin Carta Porte" columnas={COLUMNAS_SIN_CCP} filas={filas} idFila={(f) => f.clave} densa tarjetaMovil />}
      </div>
    </Tarjeta>
  );
}

/**
 * CT-A345-04: avisa cuando los catálogos del SAT no están cargados. Con un catálogo vacío la validación NO puede decir que
 * una clave existe ni que no: degrada a «no se pudo verificar» y el PAC es quien valida al timbrar. Sin este aviso,
 * un documento «sin fallas» se leería como «clave verificada».
 */
export const TEXTO_CATALOGOS_SAT_VACIOS = 'Los catálogos del SAT todavía no están cargados en Likida, así que las claves de estos catálogos no se verifican aquí: aparecen como «no se pudo verificar» y las valida tu PAC al timbrar. Un documento sin fallas no significa que sus claves estén verificadas.';
export const TEXTO_CATALOGOS_SAT_NO_LEIDOS = 'No pudimos comprobar si los catálogos del SAT están cargados. No des por verificadas las claves de los documentos.';

export function AvisoCatalogosSat({ catalogosSat }: { catalogosSat: ConteoCatalogosSat | 'no_leido' }) {
  if (catalogosSat === 'no_leido') {
    return <div data-catalogos-sat="no_leido"><Aviso tono="warn">{TEXTO_CATALOGOS_SAT_NO_LEIDOS}</Aviso></div>;
  }
  const { filas, vacios } = estadoCatalogosSat(catalogosSat);
  if (vacios.length === 0) return null;
  return (
    <div data-catalogos-sat={vacios.length === filas.length ? 'vacios' : 'parcial'}>
      <Aviso tono="warn">
        {vacios.length === filas.length ? TEXTO_CATALOGOS_SAT_VACIOS : 'Faltan por cargar algunos catálogos del SAT: sus claves aparecen como «no se pudo verificar» y las valida tu PAC al timbrar.'}
        <ul className="rv-cp__lista">
          {filas.map((f) => <li key={f.catalogo}>{f.nombre}: {f.n === 0 ? 'sin cargar' : `${numero(f.n)} claves`}</li>)}
        </ul>
      </Aviso>
    </div>
  );
}
