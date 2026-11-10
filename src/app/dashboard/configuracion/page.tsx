import { redirect } from 'next/navigation';
import { Fuel, Building2 } from 'lucide-react';
import { getConfig } from '@/lib/likida/config';
import { resolverTenantEfectivo } from '@/lib/auth/tenant-efectivo';
import { resolverTenantAtadoOLanza } from '@/lib/auth/tenant-atado';
import { puedeVerRuta } from '@/lib/auth/visibilidad';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { logger } from '@/lib/logger';
import { revalidatePath } from 'next/cache';
import {
  guardarAjustesOperativos, guardarRfcsAdicionales, parsearRfcsAdicionales,
  MAX_RFCS_ADICIONALES, mensajeParaPantalla,
} from '@/lib/likida/administracion';
import { validarAjustes } from '@/lib/likida/ajustes_operativos';
import { cuentasDeclaradas } from '@/lib/likida/contabilidad/catalogo';
import { FormaAjustes, type ResultadoGuardar } from './forma';
import { ajustesIniciales, type EstadoCatalogo } from './inicial';
import type { Metadata } from 'next';
import {
  MarcoPagina, Tarjeta, TablaBase, EstadoError, FormaConAviso, CampoTextarea, Icono, type ColumnaBase, type ResultadoAccion,
} from '@/app/ui-v2/componentes';
import './configuracion.css';
export const metadata: Metadata = { title: 'Configuración' };

export const dynamic = 'force-dynamic';

/**
 * Configuración — los parámetros con los que el motor cuadra los viajes de
 * ESTA flota, y desde el 14-ago-2026 EDITABLES.
 *
 * Antes eran 168 líneas sin un solo formulario. Un contralor cuyos
 * tractocamiones rinden 2.4 km/L y no 3.0 tenía el motor calculando mal el
 * diésel esperado de CADA viaje, y su única salida era escribirle a Javier —
 * o sea, Likida era el cuello de botella de su propia operación. El cliente
 * ya puede tunear a sus agentes sin código; esto es lo mismo para el motor.
 *
 * QUÉ SIGUE SIENDO DE LECTURA, Y POR QUÉ:
 *  · El RFC — es identidad fiscal, se captura en el alta y cambiarlo apaga la
 *    validación de receptor de TODOS los CFDI históricos.
 *  · Las unidades calibradas — es un editor de lista (alta/baja por placa) y
 *    merece su propia pantalla en el Registro, no un textarea aquí.
 *  · Los topes de la LEY (estímulos, claves del SAT) — ver `ajustes_operativos.ts`.
 */
export default async function ConfiguracionPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; tenant?: string; rol?: string }>;
}) {
  const sp = await searchParams;
  const { tenantId, rol } = await resolverTenantEfectivo('/dashboard/configuracion', sp);
  if (!puedeVerRuta(rol, '/dashboard/configuracion')) redirect('/dashboard');

  let config;
  try {
    config = await getConfig(tenantId);
  } catch {
    config = null;
  }

  // Un viaje REAL de la flota para la vista previa. Sin viajes con km
  // capturados NO se inventa uno: la pantalla lo dice y ya.
  // A37-S17-08: fallar cerrado y decirlo — una lectura caída NO es «no hay viajes»,
  // y una excepción aquí no debe tumbar toda la pantalla.
  let ejemploKm: number | null = null;
  let ejemploIlegible = false;
  try {
    const { data: viajeEjemplo, error: errViaje } = await supabaseAdmin()
      .from('viaje').select('km_recorridos')
      .eq('tenant_id', tenantId).not('km_recorridos', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle();
    if (errViaje) throw new Error(errViaje.message);
    ejemploKm = typeof viajeEjemplo?.km_recorridos === 'number' && viajeEjemplo.km_recorridos > 0
      ? viajeEjemplo.km_recorridos
      : null;
  } catch (e) {
    // PRU-02/OP40-10 (cierre100): antes el `catch` mudo culpaba a «nosotros» siempre (la columna estaba mal escrita y nadie lo supo).
    logger.warn('configuracion.viaje_ejemplo_no_leido', { tenantId, error: e instanceof Error ? e.message : String(e) });
    ejemploIlegible = true;
  }

  const unidades = config ? Object.entries(config.unidades) : [];

  // AUDITORÍA 24, ARQ-3: el catálogo se lee del OVERRIDE de la flota, no de
  // `config` (que trae las cuentas demo fusionadas). Fallar cerrado: una
  // lectura caída no es «no declaró nada», y por eso tiene su propio estado —
  // si se enseñara vacío, el siguiente «Guardar» borraría el catálogo real.
  let cuentas: Record<string, string> | null = null;
  let estadoCatalogo: EstadoCatalogo;
  try {
    cuentas = await cuentasDeclaradas(tenantId);
    estadoCatalogo = cuentas ? 'declarado' : 'sin_declarar';
  } catch {
    estadoCatalogo = 'ilegible';
  }

  async function guardar(_previo: ResultadoGuardar, fd: FormData): Promise<ResultadoGuardar> {
    'use server';
    // Re-gateo ADENTRO: el rol de arriba es del render, no de esta llamada, y
    // una server action es alcanzable sin pasar por la página.
    const s = await resolverTenantAtadoOLanza('/dashboard/configuracion', sp, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/configuracion')) {
      return { ok: false, error: 'Tu rol no puede cambiar la configuración de la flota.' };
    }
    try {
      // A37-S17-02: vaciar el catálogo sigue prohibido, pero una flota que NUNCA lo declaró puede guardar su tabulador sin inventar
      // cuentas. Se relee del tenant efectivo; si no se puede leer, fail-closed (se exige catálogo, como siempre).
      let sinCatalogoDeclarado = false;
      try { sinCatalogoDeclarado = (await cuentasDeclaradas(s.tenantId)) === null; } catch { sinCatalogoDeclarado = false; }
      // La validación del cliente es para avisar; ÉSTA es la que manda.
      const ajustes = validarAjustes({
        rendimientoPorDefecto: String(fd.get('rendimientoPorDefecto') ?? ''),
        factorCarga: String(fd.get('factorCarga') ?? ''),
        precioDieselPorDefecto: String(fd.get('precioDieselPorDefecto') ?? ''),
        umbralDesviacionPct: String(fd.get('umbralDesviacionPct') ?? ''),
        salida: String(fd.get('salida') ?? ''),
        cuentas: String(fd.get('cuentas') ?? ''),
      }, { permitirCatalogoVacio: sinCatalogoDeclarado });
      await guardarAjustesOperativos(s.tenantId, ajustes, { id: s.userId });
      return { ok: true };
    } catch (e) {
      // Un DatoInvalido sale con su texto tal cual (es culpa de lo capturado);
      // cualquier otra cosa se loguea y sale como falla del sistema, para no
      // acusar al usuario de un error de base de datos.
      return { ok: false, error: mensajeParaPantalla(e, 'guardar los ajustes') };
    }
  }

  // AUDITORÍA 20, hallazgo 7 (MEDIO-BAJO): `rfcsAdicionales` se consumía en el
  // motor y se mostraba en esta misma pantalla, pero NADA en `src/` lo
  // escribía — la única forma de declarar la segunda razón social de la flota
  // era un UPDATE a mano sobre `tenant.config`. Éste es el campo que faltaba.
  const rfcPrincipal = config?.empresa.rfc ?? '';
  async function guardarRfcs(_previo: ResultadoAccion, fd: FormData): Promise<ResultadoAccion> {
    'use server';
    // Re-gateo ADENTRO, igual que la acción de arriba: una server action es
    // alcanzable sin pasar por la página, y esto toca la validación fiscal de
    // TODOS los CFDI de gasto de la flota.
    const s = await resolverTenantAtadoOLanza('/dashboard/configuracion', sp, tenantId);
    if (!puedeVerRuta(s.rol, '/dashboard/configuracion')) {
      return { error: 'Tu rol no puede cambiar la configuración de la flota.' };
    }
    try {
      // El RFC principal se relee CONTRA EL TENANT EFECTIVO, no el del render:
      // un superadmin que abrió con ?tenant= tiene enfrente otra flota, y
      // compararlo contra el RFC de la del render dejaría pasar como
      // "adicional" el RFC principal de la que se está editando.
      const cfg = await getConfig(s.tenantId);
      const rfcs = parsearRfcsAdicionales(String(fd.get('rfcsAdicionales') ?? ''), cfg.empresa.rfc);
      await guardarRfcsAdicionales(s.tenantId, rfcs, { id: s.userId });
      revalidatePath('/dashboard/configuracion');
      return {
        ok: rfcs.length === 0
          ? 'Listo: esta flota factura con un solo RFC. Los CFDI a nombre de cualquier otro vuelven a salir a revisión.'
          : `Listo: el motor ya acepta CFDI de gasto a nombre de ${rfcs.join(', ')}.`,
      };
    } catch (e) {
      return { error: mensajeParaPantalla(e, 'guardar los RFC adicionales') };
    }
  }

  const inicial = ajustesIniciales(config, cuentas);

  type FilaUnidad = { placa: string; rendimientoBase: number; capacidadTanque: number };
  const filasUnidades: FilaUnidad[] = unidades.map(([placa, u]) => ({ placa, rendimientoBase: u.rendimientoBase, capacidadTanque: u.capacidadTanque }));
  const columnasUnidades: ColumnaBase<FilaUnidad>[] = [
    { id: 'placa', titulo: 'Placa', principal: true, celda: (u) => <span className="cifra-mono">{u.placa}</span> },
    { id: 'rend', titulo: 'Rendimiento base', alinear: 'der', celda: (u) => <span className="tabular">{u.rendimientoBase} km/L</span> },
    { id: 'tanque', titulo: 'Capacidad de tanque', alinear: 'der', celda: (u) => <span className="tabular">{u.capacidadTanque} L</span> },
  ];

  return (
    <MarcoPagina titulo="Configuración" apoyo="Lo que el motor usa para cuadrar tus viajes.">
      {config === null ? (
        <EstadoError reintentar>No se pudo leer la configuración de esta flota. No es que esté vacía: la lectura falló.</EstadoError>
      ) : (
        <>
          <Tarjeta titulo="La empresa" info="configuracion.empresa">
            <div className="rv-cfg__empresa">
              <span className="rv-cfg__sello" aria-hidden="true"><Icono icono={Building2} tam={18} /></span>
              <div>
                <p className="rv-cfg__rfc cifra-mono">{config.empresa.rfc}</p>
                <p className="rv-cfg__nota">
                  RFC contra el que se valida que un CFDI de gasto sea tuyo. Si no coincide con el receptor del
                  comprobante, el motor lo marca como no verificable. No se edita aquí: cambiarlo apaga esa
                  validación sobre todo tu histórico — se corrige con nosotros.
                </p>
                {config.empresa.rfcsAdicionales && config.empresa.rfcsAdicionales.length > 0 && (
                  <p className="rv-cfg__nota">También se aceptan: {config.empresa.rfcsAdicionales.join(', ')}</p>
                )}
              </div>
            </div>
          </Tarjeta>

          {/* Las OTRAS razones sociales, EDITABLES desde el 29-ago-2026. El
              RFC principal sigue sin formulario (cambiarlo apaga la
              validación de receptor sobre todo el histórico); éstos se
              SUMAN a él y por eso sí son del cliente. */}
          <Tarjeta titulo="Otras razones sociales que facturas" info="configuracion.rfcs_adicionales">
            <p className="rv-cfg__apoyo">
              Si tu operación factura con más de un RFC (dos empresas del mismo grupo, la razón social
              vieja y la nueva), decláralos aquí y el motor aceptará como tuyos los CFDI de gasto
              timbrados a cualquiera de ellos. Sin esto, salen «a revisar» uno por uno.
              Máximo {MAX_RFCS_ADICIONALES}. Dejarlo vacío y guardar los borra: vuelves a facturar con un
              solo RFC.
            </p>
            <FormaConAviso accion={guardarRfcs} boton="Guardar RFC adicionales" columnas="md:grid-cols-1">
              <CampoTextarea etiqueta="RFC adicionales — uno por línea o separados por coma" id="rfcsAdicionales" name="rfcsAdicionales" rows={3} spellCheck={false}
                defaultValue={(config.empresa.rfcsAdicionales ?? []).join('\n')} claseControl="cifra-mono"
                placeholder={`Distinto de ${rfcPrincipal}`}
                ayuda={`Se comprueban forma y dígito verificador, igual que en el alta de la flota. El RFC principal (${rfcPrincipal}) no va aquí.`} />
            </FormaConAviso>
          </Tarjeta>

          <FormaAjustes inicial={inicial} ejemploKm={ejemploKm} ejemploIlegible={ejemploIlegible} guardar={guardar} catalogo={estadoCatalogo} />

          <Tarjeta titulo="Unidades calibradas" info="configuracion.unidades">
            <p className="rv-cfg__apoyo">Placas con consumo propio, que le ganan al rendimiento por defecto de arriba.</p>
            <TablaBase etiqueta="Rendimiento base por placa" columnas={columnasUnidades} filas={filasUnidades} idFila={(u) => u.placa} altoMaximo={false}
              vacio={{ titulo: 'Ninguna placa calibrada', texto: 'Todas usan el rendimiento por defecto. Darlas de alta una por una todavía se hace con nosotros.' }} />
          </Tarjeta>
        </>
      )}
    </MarcoPagina>
  );
}
