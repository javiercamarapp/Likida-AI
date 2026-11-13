import { ExternalLink } from 'lucide-react';
import './facturas.css';
import '../../estados.css';
import { AvisoCompacto, Icono, StatusChip, TablaBase, Tarjeta, clasesBoton, type ColumnaBase, type TonoEstado } from '@/app/ui-v2/componentes';
import { CajonPortal } from './portal-cajon';
import { fechaCorta } from '@/lib/formato';
import type { EstadoVinculo } from '@/lib/likida/facturacion/vinculo_portal';
import { ControlesRelogin, type AccionRelogin, type EstadoRelogin } from './relogin-controles';
import { VincularAsistida } from './vincular-asistida';
import { type TAgentes, type TrAgentes, TR_ES } from '@/app/dashboard/agentes/i18n-agentes';

// ════════════════════════════════════════════════════════════════════════════
// EL ESTADO DEL VÍNCULO, POR PORTAL — la pantalla que faltaba.
//
// Hasta ahora, un portal que pedía cuenta se veía en la cola del jefe ticket
// por ticket («Este portal se captura con tu sesión») y en ningún sitio se
// podía ver el PORTAL: si está vinculado, desde cuándo, y si se cayó. Con la
// sesión persistente encendida eso pasa a ser lo que hay que mirar — un
// portal vinculado factura solo diez tickets y no aparece en ninguna cola,
// hasta el día en que su sesión caduca y aparecen los diez de golpe.
//
// LAS REGLAS DE LA CASA QUE ESTA TABLA CUMPLE:
//
//   · `vinculos === null` NO es «ninguno vinculado»: es «no se pudo leer», y
//     se dice con esas palabras. Pintar «sin vincular» sobre una lectura
//     caída mandaría al contralor a re-vincular trece portales que están
//     bien (misma regla que `guardadas === null` en seccion-credenciales).
//   · Ninguna fecha se inventa. Un portal sin fila no enseña fecha, enseña
//     «nadie ha entrado todavía».
//   · El botón lleva al portal REAL del catálogo, no a un modal que promete
//     una vinculación remota que hoy no existe.
// ════════════════════════════════════════════════════════════════════════════

const pildora = (tx: TAgentes = TR_ES.t): Record<EstadoVinculo, { rotulo: string; tono: TonoEstado }> => ({
  vinculado: { rotulo: tx('rest.vinculado'), tono: 'ok' },
  caducada: { rotulo: tx('rest.sesion_caducada'), tono: 'warn' },
  sin_vincular: { rotulo: tx('rest.sin_vincular'), tono: 'muted' },
});

export interface FilaPortal {
  clave: string;
  nombre: string;
  /** La URL del portal, del catálogo. Es a donde lleva «Vincular ahora». */
  portal: string;
  estado: EstadoVinculo;
  /** ISO del último login humano que produjo sesión, si lo hubo. */
  vinculadaEn: string | null;
  /** ISO de cuándo el portal rechazó la sesión guardada, si pasó. */
  caducadaEn: string | null;
  /** Qué se vio, en palabras. Nunca una cookie. */
  motivo: string | null;
  /**
   * El permiso de re-login automático de ESTE portal (0233). `null` = no se
   * pudo leer, y los controles lo dicen — misma regla que `vinculos`.
   */
  relogin: EstadoRelogin | null;
}

export function SeccionPortales({ filas, vinculos, autorizarRelogin, revocarRelogin, flota = null, tr = TR_ES }: {
  filas: FilaPortal[];
  /** `false` = la lectura del estado falló. NO es «ninguno vinculado». */
  vinculos: boolean;
  /** Server actions del permiso. Re-verifican sesión, rol y flota ADENTRO. */
  autorizarRelogin: AccionRelogin;
  revocarRelogin: AccionRelogin;
  /** MX-002: la flota pintada, firmada; viaja en los formularios de vincular. */
  flota?: string | null; tr?: TrAgentes;
}) {
  const { t: tx } = tr;
  const caducados = filas.filter((f) => f.estado === 'caducada');

  const columnas: ColumnaBase<FilaPortal>[] = [
    {
      id: 'portal', titulo: tx('facturas.portales.colPortal'), principal: true,
      celda: (f) => (
        <span className="rv-fact__dos">
          <strong>{f.nombre}</strong>
          {f.motivo && f.estado !== 'vinculado' && <span className="rv-fact__sub">{f.motivo}</span>}
        </span>
      ),
    },
    { id: 'estado', titulo: tx('facturas.portales.colEstado'), celda: (f) => { const p = pildora(tx)[f.estado]; return <StatusChip tono={p.tono}>{p.rotulo}</StatusChip>; } },
    { id: 'desde', titulo: tx('facturas.portales.colSesion'), celda: (f) => <span className="rv-fact__tenue">{leyenda(f, tx)}</span> },
    {
      id: 'accion', titulo: tx('facturas.portales.colAccion'), alinear: 'der',
      celda: (f) => (
        <CajonPortal titulo={f.nombre} subtitulo={leyenda(f, tx)} disparador={tx('facturas.portales.vistaRapida')}
          cifras={[
            { etiqueta: tx('facturas.portales.cifraEstado'), valor: pildora(tx)[f.estado].rotulo },
            { etiqueta: tx('facturas.portales.cifraVinculadoDesde'), valor: f.vinculadaEn ? fechaCorta(f.vinculadaEn) : '—' },
            { etiqueta: tx('facturas.portales.cifraSesionCaida'), valor: f.caducadaEn ? fechaCorta(f.caducadaEn) : '—' },
            { etiqueta: tx('facturas.portales.cifraReconexion'), valor: f.relogin === null ? '—' : f.relogin.permitido ? tx('facturas.portales.reconexionSi') : tx('facturas.portales.reconexionNo') },
          ]}
          pie={(
            <a href={f.portal} target="_blank" rel="noopener noreferrer" className={clasesBoton('primary')}>
              {tx('rest.abrir_el_portal')}<Icono icono={ExternalLink} tam={14} />
            </a>
          )}>
          {/* 0540: el paso humano del CAPTCHA/MFA con código de un solo uso. También con el portal vinculado: «re-vincular» antes de que caduque. */}
          <VincularAsistida clave={f.clave} nombre={f.nombre} flota={flota} />
          {/* El permiso de re-login es por portal (una flota puede querer reconexión en la gasolinera diaria y no en el portal de su facturación del año). */}
          <ControlesRelogin clave={f.clave} nombre={f.nombre} estado={f.relogin} autorizar={autorizarRelogin} revocar={revocarRelogin} />
          {/* LO QUE NO SE PROMETE: Likida no resuelve ni rodea CAPTCHAs ni guarda tu contraseña con «Vincular con código». */}
          <p className="rv-fact__nota" data-tono="faint">{tx('rest.vincular_con_codigo_te_da_un')}</p>
        </CajonPortal>
      ),
    },
  ];

  return (
    <Tarjeta titulo={tx('rest.tus_portales')} className="rv-tarjeta--tabla" estado={!vinculos ? 'error' : filas.length === 0 ? 'vacio' : 'ok'}
      mensaje={!vinculos ? tx('rest.no_se_pudo_leer_el_estado') : tx('rest.ningun_portal_por_vincular')}
      detalle={tx('rest.ninguno_de_los_comercios_de_tus')}>
      <div className="rv-fact__pila rv-fact__portales">
        <div className="rv-fact__portales-pad">
          <p className="rv-fact__nota">{tx('rest.portales_que_piden_tu_cuenta_entras')}</p>
          {caducados.length > 0 && (
            <AvisoCompacto tono="warn" resumen={caducados.length === 1
              ? tx('rest.se_cayo_la_sesion_de_sus', { nombre: caducados[0].nombre })
              : tx('rest.se_cayeron_sesiones_sus_tickets_estan', { length: caducados.length })} />
          )}
        </div>
        <TablaBase<FilaPortal> etiqueta={tx('rest.tus_portales')} columnas={columnas} filas={filas} idFila={(f) => f.clave} tarjetaMovil />
      </div>
    </Tarjeta>
  );
}

/** La línea de fecha. Nunca afirma una fecha que no exista. */
function leyenda(f: FilaPortal, tx: TAgentes = TR_ES.t): string {
  if (f.estado === 'vinculado') {
    return f.vinculadaEn ? `Vinculado desde el ${fechaCorta(f.vinculadaEn)}` : 'Vinculado';
  }
  if (f.estado === 'caducada') {
    const cayo = f.caducadaEn ? tx('rest.se_cayo_el', { fechaCorta: fechaCorta(f.caducadaEn) }) : tx('rest.se_cayo');
    return f.vinculadaEn ? tx('rest.lo_habias_vinculado_el', { cayo, fechaCorta: fechaCorta(f.vinculadaEn) }) : cayo;
  }
  return tx('rest.nadie_ha_entrado_todavia_sus_tickets');
}
