import { Phone, PhoneOff, IdCard, UserPlus } from 'lucide-react';
import { numero, fechaCorta } from '@/lib/formato';
import { clasificarVigencia, DIAS_AVISO } from '@/lib/likida/vigencias';
import type { ConteosOperadores } from '@/lib/likida/administracion';
import { urlRegistro, type PaginaRegistroUI } from '../paginar-registro';
import { FiltroRegistro } from '../registro-filtro';
import { FormaOperador, FormaAltaOperador, type AccionForma, type PatioOpcion } from './forma';
import { InvitarPendientes, InvitarUno, type AccionInvitar } from './invitaciones';
import { ImportadorMasivo, type AccionImportacion } from '../importador-masivo';
import type { InvitacionDeOperador } from '@/lib/likida/invitacion_operador';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import {
  AvisoCompacto, EstadoError, EstadoVacio, Icono, StatusChip, TablaBase, BotonEnlace, type ColumnaBase,
} from '@/app/ui-v2/componentes';
import { CajonVistaRapida, EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { CajonAlta } from '../cajon-alta';
import './operadores.css';
import { TR_OPERACION_ES, type TrOperacion } from '@/lib/i18n/operacion_tr';

/** La fila del registro — SIN el dinero que `OperadorDetalle` trae (ver
 *  encabezado de page.tsx: la fuga del 4-ago). `licencia` y `rfc` SÍ viajan:
 *  no son dinero, y el formulario de edición (A2) los necesita para
 *  precargarse. */
export interface FilaOperador {
  operadorId: string;
  nombre: string;
  telefono: string | null;
  numeroEmpleado: string | null;
  activo: boolean;
  viajes: number;
  licencia: string | null;
  licenciaTipo: string | null;
  /** ISO AAAA-MM-DD, o null = NO CAPTURADA (≠ vencida). */
  licenciaVence: string | null;
  /** RFC del trabajador (mig. 0080, RLISR 57). */
  rfc: string | null;
  /** El patio (W2): uuid y nombre, o null = sin patio. */
  terminalId: string | null;
  terminalNombre: string | null;
  /** La invitación por WhatsApp (W2); null = no se pudo leer. */
  invitacion: InvitacionDeOperador | null;
  /** ¿ESTA fila cae dentro del alcance del usuario? Un jefe con patio solo edita
   *  los de su patio; lo decide el servidor con el patio leído de la base. */
  editable: boolean;
}

/** A cuántos días de hoy vence — comparación lexicográfica de ISO AAAA-MM-DD
 *  contra el día de México que manda la página. */
function diasParaVencer(vence: string, hoy: string): number {
  return Math.round((Date.parse(`${vence}T00:00:00Z`) - Date.parse(`${hoy}T00:00:00Z`)) / 86_400_000);
}

// El umbral y las FRONTERAS de estado son compartidos con `/dashboard/unidades`
// (vigencias.ts): "por vencer" tiene que querer decir lo mismo en las dos
// pantallas, o el gerente aprende dos reglas para el mismo concepto. Lo que NO
// se comparte es el TEXTO: aquí se enseña la fecha real ("vigente hasta 12 mar
// 2027"), que dice más que un conteo de días cuando hay una sola fecha que
// mirar. En Unidades son tres papeles y ahí gana el conteo.

/**
 * El Registro de Operadores (F2): quién maneja, cómo localizarlo y qué
 * vigencia lo ancla — el mismo patrón de vigencias aplicado a la licencia (0053).
 * "Sin registrar" se dice tal cual: inventar una fecha marcaría de vencido
 * (o de vigente) a quien no lo está.
 */
/**
 * FE-12 (22-ago-2026): pintaba TODOS los operadores activos y, por cada uno,
 * un `<FormaOperador>` completo plegado. Con 7,500 choferes eso son 7,500
 * formularios en el HTML de una pantalla donde se corrige UNO. Ahora `?q=` y
 * `?p=` acotan lo que se pinta y la forma existe solo para `?editar=<id>`.
 */
export function VistaOperadores({ tr = TR_OPERACION_ES,
  filas, pag, conteos, totalConocido, hoy, puedeEditar, guardarOperador, ilegible = false, sufijo, camposOcultos,
  patios, patioDelJefe, altaOperador, sinWhatsApp = false, cargarOperadores, invitar, plantillaCsv, invitaciones, hrefPatios, hrefGuia,
}: { tr?: TrOperacion;
  /** Las filas de ESTA página. Ya vienen cortadas por la base. */
  filas: FilaOperador[];
  /** La página, con el `total` y el `filtrados` que CONTÓ la base (auditoría
   *  24). No se recuentan aquí: el largo de una página no es un total. */
  pag: PaginaRegistroUI<FilaOperador>;
  /** Los KPIs sobre la FLOTA ENTERA. `null` = no se pudieron contar, y
   *  entonces se pinta «—»: un 0 se leería como una medición. */
  conteos: ConteosOperadores | null;
  /** ¿Se sabe cuántos hay en el padrón entero? Cuando no —`conteos` cayó y
   *  además hay búsqueda— el pie no puede decir «de N» sin inventarlo. */
  totalConocido: boolean;
  hoy: string;
  /** `?tenant=`/`?vista=`/`?rol=` del superadmin. */
  sufijo: string;
  camposOcultos: Array<[string, string]>;
  /** La lectura del registro falló (FE-3). NO es lo mismo que una flota sin
   *  operadores: se dice, en vez de pintar el vacío que invita a dar de alta
   *  gente que quizá ya está dada de alta. */
  ilegible?: boolean;
  /** `puedeAdministrar(rol)` — solo quien administra la flota corrige datos
   *  de un operador (auditoría 2, A2). Sin esto la fila de edición ni se
   *  pinta: la pantalla no ofrece un botón que el rol no puede usar. */
  puedeEditar: boolean;
  guardarOperador: AccionForma;
  /** Los patios de la flota (W2). */
  patios: PatioOpcion[];
  /** El nombre del patio de un jefe CON patio (carga y altas caen ahí); null = toda la flota. */
  patioDelJefe: string | null;
  altaOperador: AccionForma;
  /** La flota entrega el desglose por correo (0932): el alta admite operadores sin WhatsApp. */
  sinWhatsApp?: boolean;
  cargarOperadores: AccionImportacion;
  invitar: AccionInvitar;
  /** El CSV de la plantilla (con BOM), armado en el servidor. */
  plantillaCsv: string;
  /** Pendientes de invitar y con fallo, o null si no se pudieron contar. */
  invitaciones: { pendientes: number; conFallo: number } | null;
  hrefPatios: string;
  hrefGuia: string;
}) {
  const { t, idioma } = tr;
  // Los KPIs son de la FLOTA ENTERA y los cuenta la base. Contarlos aquí sobre
  // `filas` diría que no hay licencias vencidas porque cayeron en la página 12.
  // `null` NO se convierte en 0: `—` dice «no lo sé», un 0 dice «no hay».
  const kpi = (v: number | undefined) => (v === undefined ? '—' : numero(v, idioma));
  const hayFiltro = pag.q !== '';

  const editado = pag.editando ? filas.find((f) => f.operadorId === pag.editando) : undefined;
  const hrefDe = (f: FilaOperador) => urlRegistro('/dashboard/operadores', sufijo, {
    q: pag.q || null, p: pag.pagina,
    editar: pag.editando === f.operadorId ? null : f.operadorId,
  });
  const columnas: ColumnaBase<FilaOperador>[] = [
    {
      id: 'operador', titulo: t('op.col.operador'), principal: true,
      celda: (f) => (
        <>
          {f.nombre}
          {f.numeroEmpleado && <span className="rv-eq__tenue">Nº {f.numeroEmpleado}</span>}
        </>
      ),
    },
    {
      id: 'telefono', titulo: t('op.col.telefono'),
      celda: (f) => (f.telefono ? (
        <span className="rv-eq__tel"><Icono icono={Phone} tam={14} /> {f.telefono}</span>
      ) : (
        <span className="rv-eq__tel" data-falta><Icono icono={PhoneOff} tam={14} /> {t('op.sintelefono')}</span>
      )),
    },
    { id: 'patio', titulo: t('op.col.patio'), celda: (f) => f.terminalNombre ?? <span className="rv-eq__tenue">{t('op.sinpatio')}</span> },
    { id: 'viajes', titulo: t('op.col.viajes'), alinear: 'der', celda: (f) => numero(f.viajes, idioma) },
    { id: 'licencia', titulo: t('op.col.licencia'), celda: (f) => <PillLicencia f={f} hoy={hoy} tr={tr} /> },
    {
      id: 'estado', titulo: t('op.col.estado'),
      celda: (f) => (
        <span className="rv-eq__estados">
          <StatusChip tono={f.activo ? 'ok' : 'muted'}>{f.activo ? t('op.activo') : t('op.inactivo')}</StatusChip>
          {f.activo && f.invitacion && <PillInvitacion i={f.invitacion} tr={tr} />}
        </span>
      ),
    },
  ];
  {
    columnas.push({
      id: 'acciones', titulo: t('op.col.acciones'), alinear: 'der',
      celda: (f) => (
        <span className="rv-eq__acciones">
          <BotonEnlace href={hrefDe(f)} variante="ghost" tamano="sm">{t('op.vr.ver')}</BotonEnlace>
          {f.editable && f.activo && f.telefono && f.invitacion && f.invitacion.estado !== 'enviada' && (
            <InvitarUno operadorId={f.operadorId} nombre={f.nombre} reintento={f.invitacion.estado === 'fallo'} accion={invitar} />
          )}
        </span>
      ),
    });
  }

  const cifras: PropsCifra[] = [
    { etiqueta: t('op.cifra.activos'), valor: kpi(conteos?.activos), nota: conteos ? t('op.cifra.total', { n: numero(conteos.total, idioma) }) : t('op.nocontar'), info: 'operadores.activos' },
    { etiqueta: t('op.cifra.sintel'), valor: kpi(conteos?.sinTelefono), nota: t('op.cifra.sintel.nota'), tono: conteos && conteos.sinTelefono > 0 ? 'warn' : undefined, info: 'operadores.sin_telefono' },
    { etiqueta: t('op.cifra.vencidas'), valor: kpi(conteos?.licenciasVencidas), tono: conteos && conteos.licenciasVencidas > 0 ? 'bad' : undefined, info: 'operadores.licencias_vencidas' },
    { etiqueta: t('op.cifra.vencen', { n: DIAS_AVISO }), valor: kpi(conteos?.licenciasPorVencer), tono: conteos && conteos.licenciasPorVencer > 0 ? 'warn' : undefined, info: 'operadores.licencias_por_vencer' },
  ];

  return (
    <EsqueletoTablaMaestra
      titulo={t('op.titulo')}
      apoyo={t('op.apoyo')}
      acciones={puedeEditar ? (
        <>
          <CajonAlta id="carga" titulo={t('op.carga.titulo')} disparador={t('op.carga.titulo')} tamano="xl">
            <ImportadorMasivo
              entidad="operadores" accion={cargarOperadores} plantillaCsv={plantillaCsv}
              archivoPlantilla="plantilla-operadores.csv"
              columnas={sinWhatsApp ? t('op.carga.cols.sinwa') : t('op.carga.cols.wa')}
              hrefPatios={hrefPatios} ofrecerInvitacion patioDelJefe={patioDelJefe} tope={2_000}
            />
          </CajonAlta>
          <CajonAlta id="alta" titulo={t('op.alta.titulo')} descripcion={t('op.alta.nota')} disparador={t('op.alta.titulo')} primario>
            <FormaAltaOperador accion={altaOperador} patios={patios} terminalFijo={patioDelJefe} sinWhatsApp={sinWhatsApp} />
          </CajonAlta>
        </>
      ) : undefined}
      cifras={cifras}
      selloCifras={selloHoy(t('op.sello'))}
      filtros={!ilegible && (pag.filtrados > 0 || hayFiltro) ? (
        <FiltroRegistro ruta="/dashboard/operadores" sufijo={sufijo} pagina={pag}
          sustantivo="operadores" camposOcultos={camposOcultos} />
      ) : undefined}
      avisos={(
        <>
          {puedeEditar && invitaciones && (
            <InvitarPendientes pendientes={invitaciones.pendientes} conFallo={invitaciones.conFallo}
              accion={invitar} hrefGuia={hrefGuia} />
          )}
          {!ilegible && hayFiltro && !totalConocido && (
            // No se pudo contar el padrón entero, así que el «de N» del pie sería un número inventado. Se dice.
            <AvisoCompacto tono="warn" resumen={t('op.aviso.padron')} />
          )}
        </>
      )}
      vistaRapida={editado ? (
        <CajonVistaRapida
          titulo={editado.nombre}
          subtitulo={editado.telefono ?? t('op.sintelefono')}
          hrefCerrar={urlRegistro('/dashboard/operadores', sufijo, { q: pag.q || null, p: pag.pagina, editar: null })}
          cifras={[
            { etiqueta: t('op.col.patio'), valor: editado.terminalNombre ?? '—' },
            { etiqueta: t('op.col.viajes'), valor: numero(editado.viajes, idioma) },
            { etiqueta: t('op.col.licencia'), valor: editado.licenciaVence ? fechaCorta(editado.licenciaVence, idioma) : t('op.lic.sinregistrar') },
            { etiqueta: t('op.col.estado'), valor: editado.activo ? t('op.activo') : t('op.inactivo') },
          ]}
        >
          {puedeEditar && editado.editable ? (
            <div className="rv-eq__editor">
              <p className="rv-eq__texto">{t('op.corregir', { nombre: editado.nombre })}</p>
              <FormaOperador
                accion={guardarOperador}
                operadorId={editado.operadorId}
                idPrefijo={`operador-${editado.operadorId}`}
                // La fila COMPLETA, no solo lo que se ve en la tabla: `actualizarOperador` reemplaza los campos que reciba, y un
                // formulario que no trajera el nombre lo dejaría vacío si alguien lo borra sin querer del campo.
                inicial={{
                  nombre: editado.nombre,
                  telefono: editado.telefono ?? '',
                  numeroEmpleado: editado.numeroEmpleado ?? '',
                  licencia: editado.licencia ?? '',
                  licenciaTipo: editado.licenciaTipo ?? '',
                  licenciaVence: editado.licenciaVence ?? '',
                  rfc: editado.rfc ?? '',
                  activo: editado.activo,
                  terminalId: editado.terminalId ?? '',
                }}
                patios={patios}
                patioFijo={patioDelJefe !== null}
              />
            </div>
          ) : null}
        </CajonVistaRapida>
      ) : null}
    >
      {ilegible ? (
        <EstadoError reintentar>{t('op.error')}</EstadoError>
      ) : pag.filtrados === 0 && !hayFiltro ? (
        <EstadoVacio pantalla contenido icono={UserPlus} titulo={t('op.vacio.titulo')}>
          {puedeEditar
            ? t('op.vacio.admin')
            : t('op.vacio.otro')}
        </EstadoVacio>
      ) : (
        <TablaBase<FilaOperador> etiqueta={t('op.tabla.etiqueta')} columnas={columnas} filas={filas} idFila={(f) => f.operadorId} tarjetaMovil
          vacio={{ titulo: t('op.vacio.sincoincidencias'), texto: t('op.vacio.busqueda', { q: pag.q }) }} />
      )}
    </EsqueletoTablaMaestra>
  );
}

/** El estado de la invitación por WhatsApp. Cada estado dice la verdad: «enviada» es que Meta ACEPTÓ el mensaje (no que el chofer lo haya leído). */
function PillInvitacion({ i, tr }: { i: InvitacionDeOperador; tr: TrOperacion }) {
  const { t } = tr;
  const tono = i.estado === 'enviada' ? 'ok' : i.estado === 'fallo' ? 'bad' : 'muted';
  const texto = i.estado === 'enviada' ? t('op.inv.enviada') : i.estado === 'fallo' ? t('op.inv.fallo') : t('op.inv.sininvitar');
  return <StatusChip tono={tono} title={i.estado === 'fallo' && i.fallo ? i.fallo : undefined}>{texto}</StatusChip>;
}

/** La vigencia que ancla. Cuatro estados y los cuatro son verdad: vencida / por vencer (≤30 días) / vigente / SIN REGISTRAR — el null no marca a nadie. */
function PillLicencia({ f, hoy, tr }: { f: FilaOperador; hoy: string; tr: TrOperacion }) {
  const { t, idioma } = tr;
  if (f.licenciaVence === null) {
    return <span className="rv-eq__tel"><Icono icono={IdCard} tam={14} /> {t('op.lic.sinregistrar')}</span>;
  }
  const dias = diasParaVencer(f.licenciaVence, hoy);
  const estado = clasificarVigencia(dias, 'Licencia').estado;
  const tipo = f.licenciaTipo ? `${f.licenciaTipo} · ` : '';
  if (estado === 'vencido') return <StatusChip tono="bad">{t('op.lic.vencida', { tipo, fecha: fechaCorta(f.licenciaVence, idioma) })}</StatusChip>;
  if (estado === 'por_vencer') return <StatusChip tono="warn">{dias === 0 ? t('op.lic.hoy', { tipo }) : t('op.lic.dias', { tipo, n: numero(dias, idioma) })}</StatusChip>;
  return <StatusChip tono="ok">{t('op.lic.vigente', { tipo, fecha: fechaCorta(f.licenciaVence, idioma) })}</StatusChip>;
}
