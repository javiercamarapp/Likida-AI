import Link from 'next/link';
import { Users, Phone, PhoneOff, IdCard, UserPlus } from 'lucide-react';
import { numero, fechaCorta } from '@/lib/formato';
import { clasificarVigencia, DIAS_AVISO } from '@/lib/likida/vigencias';
import type { ConteosOperadores } from '@/lib/likida/administracion';
import { EstadoVacio, EstadoError } from '@/app/admin/ui/kit';
import { BarraPagina } from '../resumen-visual';
import { urlRegistro, type PaginaRegistroUI } from '../paginar-registro';
import { FiltroRegistro } from '../registro-filtro';
import { FormaOperador, FormaAltaOperador, type AccionForma, type PatioOpcion } from './forma';
import { InvitarPendientes, InvitarUno, type AccionInvitar } from './invitaciones';
import { ImportadorMasivo, type AccionImportacion } from '../importador-masivo';
import type { InvitacionDeOperador } from '@/lib/likida/invitacion_operador';

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
export function VistaOperadores({
  filas, pag, conteos, totalConocido, hoy, puedeEditar, guardarOperador, ilegible = false, sufijo, camposOcultos,
  patios, patioDelJefe, altaOperador, cargarOperadores, invitar, plantillaCsv, invitaciones, hrefPatios, hrefGuia,
}: {
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
  cargarOperadores: AccionImportacion;
  invitar: AccionInvitar;
  /** El CSV de la plantilla (con BOM), armado en el servidor. */
  plantillaCsv: string;
  /** Pendientes de invitar y con fallo, o null si no se pudieron contar. */
  invitaciones: { pendientes: number; conFallo: number } | null;
  hrefPatios: string;
  hrefGuia: string;
}) {
  // Los KPIs son de la FLOTA ENTERA y los cuenta la base. Contarlos aquí sobre
  // `filas` diría que no hay licencias vencidas porque cayeron en la página 12.
  // `null` NO se convierte en 0: `—` dice «no lo sé», un 0 dice «no hay».
  const kpi = (v: number | undefined) => (v === undefined ? '—' : numero(v));
  const hayFiltro = pag.q !== '';

  return (
    <main className="h-full">
      <div className="rounded-2xl min-h-full hairline flex flex-col" style={{ background: 'var(--g1)' }}>
        <BarraPagina
          icono={<Users width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--muted)' }} />}
          titulo="Operadores"
        />
        <div className="px-5 py-5 flex-1 space-y-4">

          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Kpi titulo="Activos" valor={kpi(conteos?.activos)}
              nota={conteos ? `${numero(conteos.total)} en total` : 'no se pudo contar la flota'} />
            <Kpi titulo="Sin teléfono" valor={kpi(conteos?.sinTelefono)} nota="los agentes no pueden escribirles"
              tono={conteos && conteos.sinTelefono > 0 ? 'warn' : undefined} />
            <Kpi titulo="Licencias vencidas" valor={kpi(conteos?.licenciasVencidas)}
              tono={conteos && conteos.licenciasVencidas > 0 ? 'bad' : undefined} />
            <Kpi titulo={`Vencen en ${DIAS_AVISO} días`} valor={kpi(conteos?.licenciasPorVencer)}
              tono={conteos && conteos.licenciasPorVencer > 0 ? 'warn' : undefined} />
          </div>

          {puedeEditar && invitaciones && (
            <InvitarPendientes pendientes={invitaciones.pendientes} conFallo={invitaciones.conFallo}
              accion={invitar} hrefGuia={hrefGuia} />
          )}

          {puedeEditar && (
            <>
              <section id="alta" aria-labelledby="titulo-alta" className="card p-4">
                <div className="flex items-start gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ background: 'var(--canvas)', border: '1px solid var(--line)' }}>
                    <UserPlus aria-hidden width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <h2 id="titulo-alta" className="font-display text-[15px] font-semibold">Dar de alta un operador</h2>
                    <p className="mb-3 mt-0.5 text-[12.5px]" style={{ color: 'var(--muted)' }}>
                      Uno por uno. Para toda tu flota de una vez, usa la carga desde Excel o CSV de abajo.
                    </p>
                    <FormaAltaOperador accion={altaOperador} patios={patios} terminalFijo={patioDelJefe} />
                  </div>
                </div>
              </section>
              <ImportadorMasivo
                entidad="operadores" accion={cargarOperadores} plantillaCsv={plantillaCsv}
                archivoPlantilla="plantilla-operadores.csv"
                columnas="Obligatorias: nombre y teléfono (el WhatsApp con el que el chofer le escribirá a Likida). Opcionales: número de empleado, RFC, licencia, tipo y vencimiento de licencia, y patio."
                hrefPatios={hrefPatios} ofrecerInvitacion patioDelJefe={patioDelJefe} tope={2_000}
              />
            </>
          )}

          <section className="card p-4">
            <h2 className="font-display text-[15px] font-semibold mb-3">El registro</h2>
            {!ilegible && (pag.filtrados > 0 || hayFiltro) && (
              <FiltroRegistro ruta="/dashboard/operadores" sufijo={sufijo} pagina={pag}
                sustantivo="operadores" camposOcultos={camposOcultos} />
            )}
            {!ilegible && hayFiltro && !totalConocido && (
              // No se pudo contar el padrón entero, así que el «de N» del pie
              // sería un número inventado. Se dice, en vez de dejarlo pasar.
              <p className="text-[11.5px] mb-3" style={{ color: 'var(--faint)' }}>
                No pude contar el padrón completo en este momento: el total de al lado es el de los que
                coinciden con la búsqueda, no el de la flota.
              </p>
            )}
            {ilegible ? (
              <EstadoError mensaje="No pude leer el registro de operadores. No se enseña media lista: media lista se ve igual que la lista entera, solo que más corta." />
            ) : pag.filtrados === 0 && !hayFiltro ? (
              <EstadoVacio icono={<Users width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}
                accion={puedeEditar ? { href: '#alta', texto: 'Dar de alta al primero' } : undefined}>
                {puedeEditar
                  ? 'Aún no hay operadores dados de alta. Dalos de alta uno por uno arriba, o carga a toda tu flota de una vez desde un Excel o CSV.'
                  : 'Aún no hay operadores dados de alta. Quien administra tu flota los da de alta.'}
              </EstadoVacio>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="text-left" style={{ color: 'var(--faint)' }}>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Operador</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Teléfono</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Patio</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2 pr-6 text-right">Viajes</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Licencia</th>
                      <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2">Estado</th>
                      {puedeEditar && <th className="etiqueta-mono text-[10px] uppercase font-normal pb-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {filas.map((f) => (
                      <RenglonOperador key={f.operadorId} f={f} hoy={hoy}
                        puedeEditar={puedeEditar && f.editable} guardarOperador={guardarOperador}
                        patios={patios} patioFijo={patioDelJefe !== null} invitar={invitar}
                        editando={pag.editando === f.operadorId}
                        hrefEditar={urlRegistro('/dashboard/operadores', sufijo, {
                          q: pag.q || null, p: pag.pagina,
                          editar: pag.editando === f.operadorId ? null : f.operadorId,
                        })} />
                    ))}
                  </tbody>
                </table>
                {filas.length === 0 && (
                  <p className="text-[12.5px] pt-2" style={{ color: 'var(--muted)' }}>
                    Ningún operador coincide con «{pag.q}».
                  </p>
                )}
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

/**
 * Un renglón del registro + su forma de edición (auditoría 2, A2). La forma
 * va en un `<tr>` aparte con `colSpan` completo, plegada por default
 * (`Plegable`/`<details>`) — mismo patrón que `RenglonCliente` en
 * `dashboard/clientes/vista.tsx`: no pintar el formulario cuando `puedeEditar`
 * es falso, en vez de pintarlo deshabilitado, porque el rol de operación no
 * tiene ningún botón que darle.
 */
function RenglonOperador({ f, hoy, puedeEditar, guardarOperador, editando, hrefEditar, patios, patioFijo, invitar }: {
  f: FilaOperador;
  hoy: string;
  puedeEditar: boolean;
  guardarOperador: AccionForma;
  patios: PatioOpcion[];
  patioFijo: boolean;
  invitar: AccionInvitar;
  /** FE-12: solo la fila que `?editar=` nombra trae su formulario. */
  editando: boolean;
  hrefEditar: string;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--line2)' }}>
        <td className="py-2">
          <span className="font-medium block">{f.nombre}</span>
          {f.numeroEmpleado && (
            <span className="block text-[11px] cifra-mono" style={{ color: 'var(--faint)' }}>Nº {f.numeroEmpleado}</span>
          )}
        </td>
        <td className="py-2">
          {f.telefono ? (
            <span className="inline-flex items-center gap-1.5 cifra-mono" style={{ color: 'var(--muted)' }}>
              <Phone width={12} height={12} strokeWidth={1.75} /> {f.telefono}
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5" style={{ color: 'var(--warn)' }}>
              <PhoneOff width={12} height={12} strokeWidth={1.75} /> Sin teléfono
            </span>
          )}
        </td>
        <td className="py-2 text-[12.5px]" style={{ color: f.terminalNombre ? 'var(--ink2)' : 'var(--faint)' }}>
          {f.terminalNombre ?? 'Sin patio'}
        </td>
        <td className="py-2 pr-6 text-right cifra-mono">{numero(f.viajes)}</td>
        <td className="py-2"><PillLicencia f={f} hoy={hoy} /></td>
        <td className="py-2">
          <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium"
            style={f.activo
              ? { color: 'var(--ok)', background: 'var(--okbg)' }
              : { color: 'var(--muted)', background: 'var(--canvas)' }}>
            {f.activo ? 'Activo' : 'Inactivo'}
          </span>
          {f.activo && f.invitacion && <PillInvitacion i={f.invitacion} />}
        </td>
        {puedeEditar && <td className="py-2" />}
      </tr>
      {puedeEditar && !editando && (
        <tr style={{ borderColor: 'var(--line2)' }}>
          <td colSpan={7} className="pb-2">
            <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href={hrefEditar} className="text-[12px] underline hover:opacity-70 transition-opacity"
                style={{ color: 'var(--muted)' }}>
                Editar
              </Link>
              {f.activo && f.telefono && f.invitacion && f.invitacion.estado !== 'enviada' && (
                <InvitarUno operadorId={f.operadorId} nombre={f.nombre} reintento={f.invitacion.estado === 'fallo'} accion={invitar} />
              )}
            </span>
          </td>
        </tr>
      )}
      {puedeEditar && editando && (
        <tr style={{ borderColor: 'var(--line2)' }}>
          <td colSpan={7} className="pb-3">
            <>
              <FormaOperador
                accion={guardarOperador}
                operadorId={f.operadorId}
                idPrefijo={`operador-${f.operadorId}`}
                // La fila COMPLETA, no solo lo que se ve en la tabla:
                // `actualizarOperador` reemplaza los campos que reciba, y un
                // formulario que no trajera el nombre lo dejaría vacío si
                // alguien lo borra sin querer del campo.
                inicial={{
                  nombre: f.nombre,
                  telefono: f.telefono ?? '',
                  numeroEmpleado: f.numeroEmpleado ?? '',
                  licencia: f.licencia ?? '',
                  licenciaTipo: f.licenciaTipo ?? '',
                  licenciaVence: f.licenciaVence ?? '',
                  rfc: f.rfc ?? '',
                  activo: f.activo,
                  terminalId: f.terminalId ?? '',
                }}
                patios={patios}
                patioFijo={patioFijo}
              />
              <Link href={hrefEditar} className="inline-block mt-2 text-[12px] underline hover:opacity-70 transition-opacity"
                style={{ color: 'var(--muted)' }}>
                Cerrar
              </Link>
            </>
          </td>
        </tr>
      )}
    </>
  );
}

/** El estado de la invitación por WhatsApp. Cada estado dice la verdad: «enviada»
 *  es que Meta ACEPTÓ el mensaje (no que el chofer lo haya leído). */
function PillInvitacion({ i }: { i: InvitacionDeOperador }) {
  const estilo = i.estado === 'enviada'
    ? { color: 'var(--ok)', background: 'var(--okbg)' }
    : i.estado === 'fallo'
      ? { color: 'var(--bad)', background: 'var(--badbg)' }
      : { color: 'var(--muted)', background: 'var(--canvas)' };
  const texto = i.estado === 'enviada' ? 'Invitación enviada' : i.estado === 'fallo' ? 'Invitación falló' : 'Sin invitar';
  return (
    <span className="ml-1.5 inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={estilo}
      title={i.estado === 'fallo' && i.fallo ? i.fallo : undefined}>
      {texto}
    </span>
  );
}

/** La vigencia que ancla. Cuatro estados y los cuatro son verdad: vencida /
 *  por vencer (≤30 días) / vigente / SIN REGISTRAR — el null no marca a nadie. */
function PillLicencia({ f, hoy }: { f: FilaOperador; hoy: string }) {
  if (f.licenciaVence === null) {
    return (
      <span className="inline-flex items-center gap-1.5 text-[12px]" style={{ color: 'var(--faint)' }}>
        <IdCard width={12} height={12} strokeWidth={1.75} /> Sin registrar
      </span>
    );
  }
  const dias = diasParaVencer(f.licenciaVence, hoy);
  const estado = clasificarVigencia(dias, 'Licencia').estado;
  const tipo = f.licenciaTipo ? `${f.licenciaTipo} · ` : '';
  const pill = (texto: string, fg: string, bg: string) => (
    <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium" style={{ color: fg, background: bg }}>
      {texto}
    </span>
  );
  if (estado === 'vencido') return pill(`${tipo}vencida ${fechaCorta(f.licenciaVence)}`, 'var(--bad)', 'var(--badbg)');
  if (estado === 'por_vencer') return pill(dias === 0 ? `${tipo}vence hoy` : `${tipo}vence en ${numero(dias)} días`, 'var(--warn)', 'var(--warnbg)');
  return pill(`${tipo}vigente hasta ${fechaCorta(f.licenciaVence)}`, 'var(--ok)', 'var(--okbg)');
}

function Kpi({ titulo, valor, nota, tono }: { titulo: string; valor: string; nota?: string; tono?: 'warn' | 'bad' }) {
  return (
    <div className="card p-3.5">
      <div className="etiqueta-mono text-[10px] uppercase" style={{ color: 'var(--faint)' }}>{titulo}</div>
      <div className="cifra-mono text-[20px] font-medium mt-1"
        style={tono ? { color: `var(--${tono})` } : undefined}>{valor}</div>
      {nota && <div className="text-[11px] mt-0.5" style={{ color: 'var(--faint)' }}>{nota}</div>}
    </div>
  );
}
