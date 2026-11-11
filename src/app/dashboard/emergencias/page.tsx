import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { ShieldCheck, PhoneCall, HeartHandshake } from 'lucide-react';
import { fechaMx, hoyMx, numero } from '@/lib/formato';
import { selloHoy } from '@/app/dashboard/sello-hoy';
import { Cifra, TiraCifras } from '@/app/ui-v2/graficas';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
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
import type { Metadata } from 'next';
import {
  CampoFecha, CampoSelect, CampoTexto, Disclosure, EstadoVacio, FormaConAviso, MarcoPagina, StatusChip, Tarjeta, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import { AccionFila } from './accion-fila';
import './emergencias.css';
import { getT } from '@/lib/i18n/servidor';
export const metadata: Metadata = { title: 'Emergencias' };

export const dynamic = 'force-dynamic';

const RUTA = '/dashboard/emergencias';

type ParamsPagina = { tenant?: string; rol?: string; vista?: string };

// CT-SEG-22: `gate` es un AYUDANTE interno, no una accion (sin `'use server'`: Next la expondria como invocable desde el
// navegador). Vive a NIVEL DE MODULO y recibe `sp` por parametro: si fuera una funcion local del componente, las acciones
// inline la capturarian por closure y Next no puede serializarla (incidente de /despacho, 24-ago-2026).
async function gate(sp: ParamsPagina, tenantId: string): Promise<{ tenantId: string; userId: string } | { error: string }> {
  const { t } = await getT('operacion');
  const s = await resolverTenantAtadoOLanza(RUTA, sp, tenantId);
  if (!puedeVerRuta(s.rol, RUTA)) return { error: t('emg.a.rol') };
  return { tenantId: s.tenantId, userId: s.userId };
}

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
  searchParams: Promise<ParamsPagina>;
}) {
  const { t, idioma } = await getT('operacion');
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

  async function altaProveedor(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
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
    return { ok: t('emg.a.prov.ok') };
  }

  // Las acciones de FILA devuelven su resultado (antes eran `void`: un fallo se quedaba en el registro y la pantalla seguía como si
  // nada). Quitar algo del directorio de emergencia pasa por un diálogo que dice qué se pierde (`AccionFila`).
  async function verificarProveedor(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
    if ('error' in g) return { error: g.error };
    try {
      await marcarProveedorVerificado(g.tenantId, String(fd.get('id') ?? ''), g.userId);
    } catch (e) {
      logger.warn('emergencias.verificar_fallo', { err: e instanceof Error ? e.message : String(e) });
      return { error: mensajeParaPantalla(e, 'marcar el proveedor como verificado') };
    }
    revalidatePath(RUTA);
    return { ok: t('emg.a.verificado') };
  }

  async function borrarProveedor(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
    if ('error' in g) return { error: g.error };
    try {
      await borrarProveedorEmergencia(g.tenantId, String(fd.get('id') ?? ''));
    } catch (e) {
      logger.warn('emergencias.borrar_proveedor_fallo', { err: e instanceof Error ? e.message : String(e) });
      return { error: mensajeParaPantalla(e, 'quitar el proveedor') };
    }
    revalidatePath(RUTA);
    return { ok: t('emg.a.quitado') };
  }

  async function guardarPolizaAction(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
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
    return { ok: t('emg.a.poliza.ok') };
  }

  async function altaContacto(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
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
    return { ok: t('emg.a.contacto.ok') };
  }

  async function borrarContacto(_p: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
  const { t } = await getT('operacion');
    const g = await gate(sp, tenantId);
    if ('error' in g) return { error: g.error };
    try {
      await borrarContactoEmergencia(g.tenantId, String(fd.get('id') ?? ''));
    } catch (e) {
      logger.warn('emergencias.borrar_contacto_fallo', { err: e instanceof Error ? e.message : String(e) });
      return { error: mensajeParaPantalla(e, 'quitar el contacto') };
    }
    revalidatePath(RUTA);
    return { ok: t('emg.a.contacto.quitado') };
  }

  const polizaVencida = poliza?.vigenciaHasta ? poliza.vigenciaHasta < hoyMx() : false;
  const sinConfirmar = proveedores.filter((p) => !p.verificadoEn).length;

  return (
    <MarcoPagina titulo={t('emg.titulo')} apoyo={t('emg.apoyo')}>
      {!leyoOk && (
        <EstadoVacio pantalla contenido icono={ShieldCheck} titulo={t('emg.error.titulo')}>
          {t('emg.error')}
        </EstadoVacio>
      )}

      {leyoOk && (
        <>
          <TiraCifras sello={selloHoy('Directorio de emergencia')}>
            <Cifra etiqueta={t('emg.cifra.poliza')} valor={poliza ? (polizaVencida ? t('emg.poliza.vencida') : t('emg.poliza.vigente')) : t('emg.poliza.sin')}
              tono={!poliza || polizaVencida ? 'warn' : undefined} info="emergencias.poliza" />
            <Cifra etiqueta={t('emg.cifra.proveedores')} valor={numero(proveedores.length, idioma)} info="emergencias.proveedores" />
            <Cifra etiqueta={t('emg.cifra.sinconfirmar')} valor={numero(sinConfirmar, idioma)} tono={sinConfirmar > 0 ? 'warn' : undefined} info="emergencias.sin_confirmar" />
            <Cifra etiqueta={t('emg.cifra.contactos')} valor={numero(contactos.length, idioma)} info="emergencias.contactos" />
          </TiraCifras>

          {/* ── Póliza ──────────────────────────────────────────────────── */}
          <Tarjeta titulo={t('emg.poliza.titulo')} info="emergencias.poliza"
            estado={poliza ? 'ok' : 'vacio'} contenida iconoVacio={ShieldCheck}
            mensaje={t('emg.poliza.vacio')}
            detalle={t('emg.poliza.vacio.nota')}>
            {poliza && (
              <p className="rv-em__nota">
                {t('emg.poliza.resumen', {
                  aseguradora: poliza.aseguradora, numero: poliza.numeroPoliza, tel: poliza.telefonoSiniestros,
                  vigencia: poliza.vigenciaHasta ? (polizaVencida ? t('emg.poliza.vencida', { fecha: fechaMx(poliza.vigenciaHasta, idioma) }) : t('emg.poliza.hasta.fecha', { fecha: fechaMx(poliza.vigenciaHasta, idioma) })) : '',
                })}
              </p>
            )}
            <Disclosure variante="linea" titulo={poliza ? t('emg.poliza.reemplazar') : t('emg.poliza.capturar')} abierto={!poliza}>
              <FormaConAviso accion={guardarPolizaAction} boton={poliza ? t('emg.poliza.reemplazar') : t('emg.poliza.guardar')} columnas="md:grid-cols-2">
                <CampoTexto name="aseguradora" etiqueta={t('emg.poliza.aseguradora')} obligatorio defaultValue={poliza?.aseguradora ?? ''} />
                <CampoTexto name="numeroPoliza" etiqueta={t('emg.poliza.numero')} obligatorio defaultValue={poliza?.numeroPoliza ?? ''} />
                <CampoTexto name="telefonoSiniestros" etiqueta={t('emg.poliza.telefono')} obligatorio defaultValue={poliza?.telefonoSiniestros ?? ''}
                  ayuda={t('emg.poliza.telefono.ayuda')} />
                <CampoFecha name="vigenciaHasta" etiqueta={t('emg.poliza.hasta')} defaultValue={poliza?.vigenciaHasta ?? ''} />
              </FormaConAviso>
            </Disclosure>
          </Tarjeta>

          {/* ── Proveedores ─────────────────────────────────────────────── */}
          <Tarjeta titulo={t('emg.prov.titulo')} info="emergencias.proveedores"
            estado={proveedores.length === 0 ? 'vacio' : 'ok'} contenida iconoVacio={PhoneCall}
            mensaje={t('emg.prov.vacio')}
            detalle={t('emg.prov.vacio.nota')}>
            {proveedores.length > 0 && (
              <ul className="rv-em__lista">
                {proveedores.map((p) => (
                  <li key={p.id} className="rv-em__fila">
                    <span className="rv-em__nombre">{p.nombre}</span>
                    <span className="rv-em__dato">{p.tipo} · {p.telefono}{p.radioKm ? ` · ~${p.radioKm} km` : ''}</span>
                    <StatusChip tono={p.verificadoEn ? 'ok' : 'warn'}>
                      {p.verificadoEn ? `verificado ${fechaMx(p.verificadoEn, idioma)}` : t('emg.prov.sinconfirmar')}
                    </StatusChip>
                    <span className="rv-em__acciones">
                      {!p.verificadoEn && (
                        <AccionFila accion={verificarProveedor} id={p.id} etiqueta={t('emg.prov.verificado')}
                          titulo={t('emg.prov.verificado.ayuda')} />
                      )}
                      <AccionFila accion={borrarProveedor} id={p.id} etiqueta={t('emg.quitar')} tono="peligro"
                        confirmar={{
                          titulo: `Quitar a ${p.nombre}`,
                          descripcion: t('emg.prov.quitar.cuerpo'),
                          etiquetaConfirmar: t('emg.quitar.si'),
                        }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Disclosure variante="linea" titulo={t('emg.prov.agregar.titulo')} abierto={proveedores.length === 0}>
              <FormaConAviso accion={altaProveedor} boton={t('emg.prov.agregar')} columnas="md:grid-cols-3">
                <CampoSelect name="tipo" etiqueta={t('emg.prov.tipo')} obligatorio defaultValue="">
                  <option value="">{t('emg.elige')}</option>
                  {TIPOS_PROVEEDOR.map((t) => <option key={t} value={t}>{t}</option>)}
                </CampoSelect>
                <CampoTexto name="nombre" etiqueta={t('emg.prov.nombre')} obligatorio placeholder={t('emg.prov.nombre.ph')} />
                <CampoTexto name="telefono" etiqueta={t('emg.prov.telefono')} obligatorio placeholder={t('emg.prov.telefono.ph')} />
                <CampoTexto name="radioKm" tipo="number" etiqueta={t('emg.prov.radio')} min={0} />
                {/* Posición del proveedor (Capa C): con ella la cascada mide la cercanía real al incidente. Opcional en pareja — sin las
                    dos, el proveedor se lista sin ordenar y el aviso lo dice. Campos de texto a propósito: las longitudes de México son
                    negativas y un number con min=0 las rechazaría. */}
                <CampoTexto name="lat" etiqueta={t('emg.prov.lat')} placeholder="19.4326" />
                <CampoTexto name="lng" etiqueta={t('emg.prov.lon')} placeholder="-99.1332" />
                <CampoTexto name="notas" etiqueta={t('emg.prov.notas')} placeholder={t('emg.prov.notas.ph')} />
              </FormaConAviso>
            </Disclosure>
          </Tarjeta>

          {/* ── Contactos de emergencia ─────────────────────────────────── */}
          <Tarjeta titulo={t('emg.cont.titulo')} info="emergencias.contactos"
            estado={contactos.length === 0 ? 'vacio' : 'ok'} contenida iconoVacio={HeartHandshake}
            mensaje={t('emg.cont.vacio')}
            detalle={t('emg.cont.vacio.nota')}>
            {contactos.length > 0 && (
              <ul className="rv-em__lista">
                {contactos.map((c) => (
                  <li key={c.id} className="rv-em__fila">
                    <span className="rv-em__nombre">{c.nombre}</span>
                    <span className="rv-em__dato">
                      {c.operadorNombre}{c.parentesco ? ` · ${c.parentesco}` : ''} · {c.telefono}
                    </span>
                    <StatusChip tono={c.avisarSiLesionados ? 'ok' : 'muted'}>
                      {c.avisarSiLesionados ? t('emg.cont.avisar') : t('emg.cont.solo')}
                    </StatusChip>
                    <span className="rv-em__acciones">
                      <AccionFila accion={borrarContacto} id={c.id} etiqueta={t('emg.quitar')} tono="peligro"
                        confirmar={{
                          titulo: `Quitar a ${c.nombre}`,
                          descripcion: t('emg.cont.quitar.cuerpo', { operador: c.operadorNombre }),
                          etiquetaConfirmar: t('emg.quitar.si'),
                        }} />
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {operadores.length === 0 ? (
              <p className="rv-em__nota">{t('emg.cont.sinoperadores')}</p>
            ) : (
              <Disclosure variante="linea" titulo={t('emg.cont.agregar.titulo')} abierto={contactos.length === 0}>
                <FormaConAviso accion={altaContacto} boton={t('emg.cont.agregar')} columnas="md:grid-cols-3">
                  <CampoSelect name="operadorId" etiqueta={t('emg.cont.operador')} obligatorio defaultValue="">
                    <option value="">{t('emg.elige')}</option>
                    {operadores.map((o) => <option key={o.id} value={o.id}>{o.nombre}</option>)}
                  </CampoSelect>
                  <CampoTexto name="nombre" etiqueta={t('emg.cont.nombre')} obligatorio />
                  <CampoTexto name="telefono" etiqueta={t('emg.cont.telefono')} obligatorio placeholder={t('emg.cont.telefono.ph')} />
                  <CampoTexto name="parentesco" etiqueta={t('emg.cont.parentesco')} placeholder={t('emg.cont.parentesco.ph')} />
                  <CampoSelect name="avisarSiLesionados" etiqueta={t('emg.cont.lesionados')} defaultValue="no"
                    ayuda={t('emg.cont.lesionados.ayuda')}>
                    <option value="no">{t('emg.cont.no')}</option>
                    <option value="si">{t('emg.cont.si')}</option>
                  </CampoSelect>
                </FormaConAviso>
              </Disclosure>
            )}
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
  );
}
