import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { Siren, ShieldCheck, PhoneCall, HeartHandshake } from 'lucide-react';
import { fechaMx } from '@/lib/formato';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { acotada } from '@/lib/likida/presupuesto';
import { traerTodo, conteo } from '@/lib/likida/pg';
import {
  listarProveedoresEmergencia, crearProveedorEmergencia, borrarProveedorEmergencia,
  marcarProveedorVerificado, polizaVigenteDe, guardarPoliza,
  listarContactosEmergencia, crearContactoEmergencia, borrarContactoEmergencia,
  TIPOS_PROVEEDOR, type ProveedorEmergencia, type FlotaPoliza, type ContactoEmergencia,
} from '@/lib/likida/emergencias';
import { mensajeParaPantalla } from '@/lib/likida/administracion';
import { logger } from '@/lib/logger';
import { FormaConAviso, Campo, Selector, type ResultadoAccion } from '../../admin/ui/forma';

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/emergencias';

/**
 * EMERGENCIAS (Fase 5) — el directorio que el escalamiento consulta cuando un
 * chofer reporta un siniestro y nadie contesta.
 *
 * Es `operacion` a propósito: el jefe de tráfico es quien conoce a los
 * grueros de su ruta y quien captura; el dueño también entra. No enseña un
 * peso.
 *
 * Tres cosas viven aquí, y las tres tienen un porqué de vida o muerte:
 *  · PROVEEDORES — el teléfono de la grúa NO vive en ningún prompt: vive en
 *    esta tabla, con quién lo verificó y cuándo. "Verificado" significa que
 *    ALGUIEN marcó y le contestaron — capturar no es verificar.
 *  · PÓLIZA — el 800 de siniestros es EL dato de un siniestro. Likida nunca
 *    marca por su cuenta (una llamada abre un siniestro: dinero y acto
 *    jurídico); el escalamiento se lo pone en la mano a quien sí puede.
 *  · CONTACTOS del operador — un familiar que nunca aceptó ningún aviso:
 *    `avisar_si_lesionados` nace apagado y la flota lo activa contacto por
 *    contacto. Con lesionados, el dato viaja al dueño — que decide.
 */
export default async function PaginaEmergencias({
  searchParams,
}: {
  searchParams: Promise<{ tenant?: string; rol?: string; vista?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo(RUTA, sp);
  if (!puedeVerRuta(rol, RUTA)) redirect('/dashboard');

  // El patrón `leyoOk`: un fallo de lectura NO es una lista vacía. Con la
  // lectura caída no se ofrecen los formularios — capturar a ciegas sobre un
  // directorio que no se pudo leer invita a duplicar.
  let proveedores: ProveedorEmergencia[] = [];
  let poliza: FlotaPoliza | null = null;
  let contactos: Array<ContactoEmergencia & { operadorNombre: string }> = [];
  let operadores: Array<{ id: string; nombre: string }> = [];
  let leyoOk = true;
  try {
    // FE-31: sin `.limit()` esta lectura se recortaba en silencio a 1,000
    // (`max_rows`) — con cientos de operadores hoy no reproduce, pero con la
    // flota completa del piloto sí. `traerTodo` pagina hasta demostrar que
    // trajo todos, o lanza (lo atrapa el `catch` de abajo, que ya sabe
    // convertir eso en «no se pudo leer» en vez de una lista vacía).
    const opsRaw = await traerTodo<{ id: string; nombre: string }>(
      (desde, hasta) => acotada(supabaseAdmin()
        .from('operador').select('id, nombre', conteo(desde)).eq('tenant_id', tenantId)
        .order('nombre').order('id')
        .range(desde, hasta), 'emergencias.operadores'),
      'emergencias.operadores',
    );
    operadores = opsRaw.map((o) => ({ id: o.id, nombre: o.nombre }));
    [proveedores, poliza, contactos] = await Promise.all([
      listarProveedoresEmergencia(tenantId),
      polizaVigenteDe(tenantId),
      listarContactosEmergencia(tenantId),
    ]);
  } catch (e) {
    leyoOk = false;
    logger.warn('emergencias.no_leido', { tenantId, err: e instanceof Error ? e.message : String(e) });
  }

  // ── Server actions — re-gateo ADENTRO en todas (el rol del render no es el
  //    de la llamada, y una action es alcanzable sin pasar por la página) ───

  async function gate(): Promise<{ tenantId: string; userId: string } | { error: string }> {
    'use server';
    const s = await resolverTenantEfectivo(RUTA, sp);
    if (!puedeVerRuta(s.rol, RUTA)) return { error: 'Tu rol no puede editar el directorio de emergencia.' };
    return { tenantId: s.tenantId, userId: s.userId };
  }

  async function altaProveedor(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const g = await gate();
    if ('error' in g) return { error: g.error };
    try {
      await crearProveedorEmergencia(g.tenantId, {
        tipo: String(fd.get('tipo') ?? ''),
        nombre: String(fd.get('nombre') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
        lat: fd.get('lat') ? Number(fd.get('lat')) : null,
        lng: fd.get('lng') ? Number(fd.get('lng')) : null,
        radioKm: fd.get('radioKm') ? Number(fd.get('radioKm')) : null,
        notas: String(fd.get('notas') ?? '') || null,
      });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'dar de alta el proveedor') };
    }
    revalidatePath(RUTA);
    return { ok: 'Proveedor capturado. Queda "sin confirmar" hasta que alguien marque y le contesten — el botón Verificado es esa afirmación.' };
  }

  async function verificarProveedor(fd: FormData): Promise<void> {
    'use server';
    const g = await gate();
    if ('error' in g) return;
    try {
      await marcarProveedorVerificado(g.tenantId, String(fd.get('id') ?? ''), g.userId);
      revalidatePath(RUTA);
    } catch (e) {
      logger.warn('emergencias.verificar_fallo', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  async function borrarProveedor(fd: FormData): Promise<void> {
    'use server';
    const g = await gate();
    if ('error' in g) return;
    try {
      await borrarProveedorEmergencia(g.tenantId, String(fd.get('id') ?? ''));
      revalidatePath(RUTA);
    } catch (e) {
      logger.warn('emergencias.borrar_proveedor_fallo', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  async function guardarPolizaAction(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const g = await gate();
    if ('error' in g) return { error: g.error };
    try {
      await guardarPoliza(g.tenantId, {
        aseguradora: String(fd.get('aseguradora') ?? ''),
        numeroPoliza: String(fd.get('numeroPoliza') ?? ''),
        telefonoSiniestros: String(fd.get('telefonoSiniestros') ?? ''),
        vigenciaHasta: String(fd.get('vigenciaHasta') ?? '') || null,
      });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar la póliza') };
    }
    revalidatePath(RUTA);
    return { ok: 'Póliza guardada — el escalamiento ya puede poner el 800 de siniestros en la mano de quien decide.' };
  }

  async function altaContacto(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    const g = await gate();
    if ('error' in g) return { error: g.error };
    try {
      await crearContactoEmergencia(g.tenantId, {
        operadorId: String(fd.get('operadorId') ?? ''),
        nombre: String(fd.get('nombre') ?? ''),
        telefono: String(fd.get('telefono') ?? ''),
        parentesco: String(fd.get('parentesco') ?? '') || null,
        avisarSiLesionados: String(fd.get('avisarSiLesionados') ?? '') === 'si',
      });
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar el contacto') };
    }
    revalidatePath(RUTA);
    return { ok: 'Contacto guardado.' };
  }

  async function borrarContacto(fd: FormData): Promise<void> {
    'use server';
    const g = await gate();
    if ('error' in g) return;
    try {
      await borrarContactoEmergencia(g.tenantId, String(fd.get('id') ?? ''));
      revalidatePath(RUTA);
    } catch (e) {
      logger.warn('emergencias.borrar_contacto_fallo', { err: e instanceof Error ? e.message : String(e) });
    }
  }

  const BTN_CHICO = 'text-xs px-2.5 py-1 rounded-lg hairline';

  return (
    <div className="flex flex-col gap-4">
      <header className="glass-panel flex items-center gap-2.5 px-5 py-4">
        <Siren width={16} height={16} strokeWidth={1.75} />
        <div>
          <span className="text-sm font-medium block">Emergencias</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>
            La grúa, la póliza y los contactos que el escalamiento usa cuando un chofer reporta y nadie contesta
          </span>
        </div>
      </header>

      {!leyoOk && (
        <section className="rounded-2xl px-5 py-4 hairline" style={{ background: 'var(--surface)' }}>
          <p className="text-sm">No pude leer el directorio ahorita — recarga la página. No se ofrecen los formularios para no capturar a ciegas sobre lo que no se ve.</p>
        </section>
      )}

      {leyoOk && (
        <>
          {/* ── Póliza ──────────────────────────────────────────────────── */}
          <section className="rounded-2xl px-5 py-4 flex flex-col gap-3 hairline" style={{ background: 'var(--surface)' }}>
            <div className="flex items-start gap-2.5">
              <ShieldCheck width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
              <div>
                <p className="text-sm font-medium">Póliza de la flota</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  {poliza
                    ? `${poliza.aseguradora} · póliza ${poliza.numeroPoliza} · siniestros ${poliza.telefonoSiniestros}${poliza.vigenciaHasta ? ` · vigente hasta ${fechaMx(poliza.vigenciaHasta)}` : ''}. Guardar de nuevo la reemplaza (la anterior queda en la historia).`
                    : 'Sin póliza capturada. El 800 de siniestros es EL dato de un siniestro — sin él, el tercer nivel de escalamiento solo puede decir que falta.'}
                </p>
              </div>
            </div>
            <FormaConAviso accion={guardarPolizaAction} boton={poliza ? 'Reemplazar póliza' : 'Guardar póliza'} columnas="md:grid-cols-2">
              <Campo nombre="aseguradora" etiqueta="Aseguradora" requerido valorInicial={poliza?.aseguradora ?? ''} />
              <Campo nombre="numeroPoliza" etiqueta="Número de póliza" requerido valorInicial={poliza?.numeroPoliza ?? ''} />
              <Campo nombre="telefonoSiniestros" etiqueta="Teléfono de siniestros (el 800)" requerido valorInicial={poliza?.telefonoSiniestros ?? ''}
                ayuda="Solo números. Es el que el dueño va a marcar a las 3 a.m. — revísalo dos veces." />
              <Campo nombre="vigenciaHasta" etiqueta="Vigente hasta" tipo="date" valorInicial={poliza?.vigenciaHasta ?? ''} />
            </FormaConAviso>
          </section>

          {/* ── Proveedores ─────────────────────────────────────────────── */}
          <section className="rounded-2xl px-5 py-4 flex flex-col gap-3 hairline" style={{ background: 'var(--surface)' }}>
            <div className="flex items-start gap-2.5">
              <PhoneCall width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
              <div>
                <p className="text-sm font-medium">Proveedores de carretera</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  Grúas, llanteras y mecánicos de confianza de TU flota. El agente jamás inventa un teléfono: solo usa los de aquí, y rotula los que nadie ha confirmado.
                </p>
              </div>
            </div>
            {proveedores.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {proveedores.map((p) => (
                  <li key={p.id} className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 hairline flex-wrap">
                    <span className="font-medium">{p.nombre}</span>
                    <span style={{ color: 'var(--muted)' }}>{p.tipo} · {p.telefono}{p.radioKm ? ` · ~${p.radioKm} km` : ''}</span>
                    <span style={{ color: p.verificadoEn ? 'var(--ok)' : 'var(--warn)' }}>
                      {p.verificadoEn ? `verificado ${fechaMx(p.verificadoEn)}` : 'sin confirmar'}
                    </span>
                    <span className="ml-auto flex gap-1.5">
                      {!p.verificadoEn && (
                        <form action={verificarProveedor}>
                          <input type="hidden" name="id" value={p.id} />
                          <button type="submit" className={BTN_CHICO} title="Afirmo que marqué y contestaron">Verificado ✓</button>
                        </form>
                      )}
                      <form action={borrarProveedor}>
                        <input type="hidden" name="id" value={p.id} />
                        <button type="submit" className={BTN_CHICO}>Quitar</button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <FormaConAviso accion={altaProveedor} boton="Agregar proveedor" columnas="md:grid-cols-3">
              <Selector nombre="tipo" etiqueta="Tipo" requerido valorInicial=""
                opciones={[{ valor: '', texto: 'Elige uno' }, ...TIPOS_PROVEEDOR.map((t) => ({ valor: t, texto: t }))]} />
              <Campo nombre="nombre" etiqueta="Nombre" requerido placeholder="Grúas García" />
              <Campo nombre="telefono" etiqueta="Teléfono" requerido placeholder="10 dígitos" />
              <Campo nombre="radioKm" etiqueta="Radio de cobertura (km)" tipo="number" />
              {/* Posición del proveedor (Capa C): con ella la cascada mide la
                  cercanía real al incidente. Opcional en pareja — sin las dos,
                  el proveedor se lista sin ordenar y el aviso lo dice. Campos
                  de texto a propósito: el tipo number de Campo trae min=0 y
                  las longitudes de México son negativas. */}
              <Campo nombre="lat" etiqueta="Latitud (opcional)" placeholder="19.4326" />
              <Campo nombre="lng" etiqueta="Longitud (opcional)" placeholder="-99.1332" />
              <Campo nombre="notas" etiqueta="Notas" placeholder="Zona, horario, condiciones" />
            </FormaConAviso>
          </section>

          {/* ── Contactos de emergencia ─────────────────────────────────── */}
          <section className="rounded-2xl px-5 py-4 flex flex-col gap-3 hairline" style={{ background: 'var(--surface)' }}>
            <div className="flex items-start gap-2.5">
              <HeartHandshake width={16} height={16} strokeWidth={1.75} className="mt-0.5 shrink-0" style={{ color: 'var(--muted)' }} />
              <div>
                <p className="text-sm font-medium">Contactos de emergencia por operador</p>
                <p className="text-xs mt-0.5" style={{ color: 'var(--muted)' }}>
                  Un familiar que nunca aceptó ningún aviso: por eso «avisar si hay lesionados» nace apagado y se activa contacto por contacto. Likida no le marca a nadie — con lesionados, el dato le llega al dueño, que decide.
                </p>
              </div>
            </div>
            {contactos.length > 0 && (
              <ul className="flex flex-col gap-1.5">
                {contactos.map((c) => (
                  <li key={c.id} className="flex items-center gap-2 text-xs rounded-lg px-3 py-2 hairline flex-wrap">
                    <span className="font-medium">{c.nombre}</span>
                    <span style={{ color: 'var(--muted)' }}>
                      {c.operadorNombre}{c.parentesco ? ` · ${c.parentesco}` : ''} · {c.telefono}
                    </span>
                    <span style={{ color: c.avisarSiLesionados ? 'var(--ok)' : 'var(--muted)' }}>
                      {c.avisarSiLesionados ? 'avisar si hay lesionados' : 'solo expediente'}
                    </span>
                    <span className="ml-auto">
                      <form action={borrarContacto}>
                        <input type="hidden" name="id" value={c.id} />
                        <button type="submit" className={BTN_CHICO}>Quitar</button>
                      </form>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {operadores.length === 0 ? (
              <p className="text-xs" style={{ color: 'var(--muted)' }}>Esta flota aún no tiene operadores dados de alta — el contacto se ata a un operador.</p>
            ) : (
              <FormaConAviso accion={altaContacto} boton="Agregar contacto" columnas="md:grid-cols-3">
                <Selector nombre="operadorId" etiqueta="Operador" requerido valorInicial=""
                  opciones={[{ valor: '', texto: 'Elige uno' }, ...operadores.map((o) => ({ valor: o.id, texto: o.nombre }))]} />
                <Campo nombre="nombre" etiqueta="Nombre del contacto" requerido />
                <Campo nombre="telefono" etiqueta="Teléfono" requerido placeholder="10 dígitos" />
                <Campo nombre="parentesco" etiqueta="Parentesco" placeholder="esposa, hermano…" />
                <Selector nombre="avisarSiLesionados" etiqueta="¿Avisar si hay lesionados?" valorInicial="no"
                  opciones={[{ valor: 'no', texto: 'No — solo expediente' }, { valor: 'si', texto: 'Sí — el contacto lo aceptó' }]}
                  ayuda="Actívalo solo si el contacto aceptó recibir esta clase de aviso." />
              </FormaConAviso>
            )}
          </section>
        </>
      )}
    </div>
  );
}
