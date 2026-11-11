import { cifrasUniformes } from '../formato';
import { Mail, FileText, ShieldCheck, Globe, MapPin, Stamp, type LucideIcon } from 'lucide-react';
import type { Conector } from '@/lib/likida/conexiones';
import { Icono, InfoTip, MarcaIntegracion, StatusChip, Tarjeta, type TonoEstado } from '@/app/ui-v2/componentes';
import type { PropsCifra } from '@/app/ui-v2/graficas';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import './conexiones.css';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

// El estado se dice con una pastilla a la derecha (texto + punto, nunca solo color). «No se pudo medir» tiene rótulo y tono PROPIOS
// (c7-28): pintarlo con el gris de «Sin conectar» decía sobre la flota lo que solo se sabía de la consulta, y mandaba a recapturar
// credenciales que ya existían. Aquí no falta nada, falta la lectura.
const estadoConector = (t: TResto = T_RESTO_ES): Record<Conector['estado'], { rotulo: string; tono: TonoEstado }> => ({
  listo: { rotulo: t('cfg.listo'), tono: 'ok' },
  incompleto: { rotulo: t('cfg.incompleto'), tono: 'warn' },
  sin_configurar: { rotulo: t('cfg.sin_conectar'), tono: 'muted' },
  no_medible: { rotulo: t('cfg.no_se_pudo_medir'), tono: 'warn' },
  ensayo: { rotulo: t('cfg.en_ensayo'), tono: 'info' },
});

/** Logo de marca SOLO donde hay trazado verificable (WhatsApp); el resto lleva un icono sobrio del tema de la conexión. Nunca un logo inventado. */
const ICONO: Record<Conector['id'], { marca: 'whatsapp' } | { icono: LucideIcon }> = {
  whatsapp: { marca: 'whatsapp' },
  correo: { icono: Mail },
  fiscal: { icono: FileText },
  sat: { icono: ShieldCheck },
  portales: { icono: Globe },
  rastreo: { icono: MapPin },
  timbrado: { icono: Stamp },
};

function Marca({ id }: { id: Conector['id'] }) {
  const m = ICONO[id];
  if ('marca' in m) return <MarcaIntegracion id={m.marca} tam={18} />;
  const I = m.icono;
  return <Icono icono={I} tam={18} />;
}

/**
 * La pantalla de Conexiones (F7): cada renglón es un estado MEDIDO con su
 * fuente en el detalle — nunca un semáforo decorativo. Lo que falta se dice
 * en palabras de persona; las decisiones de negocio (el candado del
 * timbrado) se declaran como decisiones, no como fallas.
 */
export function VistaConexiones({ conectores, estado, credenciales, integraciones, gps, t = T_RESTO_ES }: {
  conectores: Conector[];
  /** La sección «Estado» por fuente de datos (F19, `SeccionEstado`), ya armada en el servidor. Va primero: lo que está atrasado se ve antes que el catálogo. */
  estado?: React.ReactNode;
  /** La sección "Credenciales de tus sistemas", ya armada en el servidor
   *  (`SeccionCredenciales` + acciones). Entra como ReactNode y no como
   *  datos: esta vista no debe importar el motor, que trae `supabaseAdmin`
   *  (mismo patrón que `notificaciones` en el Agente de Proveedores). */
  credenciales?: React.ReactNode;
  /** La sección "Con qué sistemas conecta Likida", que era la pantalla gemela
   *  `/dashboard/integraciones` hasta la fusión de agosto-2026. Mismo criterio
   *  de ReactNode que la de credenciales. */
  integraciones?: React.ReactNode;
  /** La sección «GPS»: salud por integración, push propio, huérfanos y mapeo (W3). */
  gps?: React.ReactNode; t?: TResto;
}) {
  // Conteos por estado MEDIDO del conector (cada uno sale de la lectura; «no se pudo medir» tiene su propia celda, nunca se suma a «sin conectar»).
  const n = (e: Conector['estado']) => conectores.filter((c) => c.estado === e).length;
  const rotulos = estadoConector(t);
  const cifras: PropsCifra[] = [
    { etiqueta: rotulos.listo.rotulo, valor: n('listo') },
    { etiqueta: rotulos.incompleto.rotulo, valor: n('incompleto'), tono: n('incompleto') > 0 ? 'warn' : undefined },
    { etiqueta: rotulos.sin_configurar.rotulo, valor: n('sin_configurar') },
    { etiqueta: rotulos.no_medible.rotulo, valor: n('no_medible'), tono: n('no_medible') > 0 ? 'warn' : undefined },
  ];
  return (
    <EsqueletoTablaMaestra titulo={t('cfg.conexiones')} apoyo={t('cfg.lo_que_tu_flota_tiene_conectado')} cifras={cifrasUniformes(cifras)}>
      {estado}

      <div data-tour="conexiones.estado">
        <Tarjeta titulo={t('cfg.estado_de_las_conexiones')}>
          <ul className="rv-cx__lista">
            {conectores.map((c) => {
              const e = estadoConector(t)[c.estado];
              return (
                <li key={c.id} className="rv-cx__fila">
                  <span className="rv-cx__marca"><Marca id={c.id} /></span>
                  <div className="rv-cx__cuerpo">
                    <span className="rv-cx__nombre">{c.nombre}<InfoTip clave="conexiones.conector" /></span>
                    <p className="rv-cx__detalle">{c.detalle}</p>
                    {c.falta.length > 0 && (
                      <ul className="rv-cx__faltas">
                        {c.falta.map((f) => <li key={f} className="rv-cx__falta">{f}</li>)}
                      </ul>
                    )}
                  </div>
                  <StatusChip tono={e.tono}>{e.rotulo}</StatusChip>
                </li>
              );
            })}
          </ul>
        </Tarjeta>
      </div>

      {/* El orden es el del trabajo: primero QUÉ está medido, luego CON
          QUÉ sabe conectar Likida, y al final DÓNDE se capturan los
          accesos — que es lo que se hace después de leer las otras dos. */}
      {integraciones}

      {gps}

      <div data-tour="conexiones.credenciales">{credenciales}</div>
    </EsqueletoTablaMaestra>
  );
}
