import { Truck, BellOff, BellRing, CheckCheck, PhoneOff } from 'lucide-react';
import { mxn } from '@/lib/utils';
import type { ViajeRow } from '@/lib/cuadra/analytics';
import { fechaMx } from '../formato';
import { confirmacionDeViaje, resumenConfirmacion } from '../confirmacion';
import { KpiTile, EstadoVacio, StatusPill, type Estado } from '../../admin/ui/kit';

// Bloques visuales de Viajes, fuera de la página para poder mirar el render sin
// sesión (mismo motivo que en Despacho, Incidencias, POD y Unidades). No es
// cosmético: la página resuelve tenant y sesión, así que un preview no la puede
// montar, y verificar una COPIA de la tabla verifica la copia.
//
// `veDinero` sigue llegando como prop desde la página, que es donde vive la
// puerta (`puedeVerArea(rol, 'dinero')`). Aquí no se decide nada de permisos:
// si esta vista resolviera el rol por su cuenta habría dos respuestas posibles
// a la misma pregunta.

/** Los TRES estatus que `viaje` de verdad admite — el dominio está fijado en
 *  la base (`viaje_estatus_dominio`, 0025_dominios_check.sql:112:
 *  `estatus in ('abierto','en_cuadre','liquidado')`), no es una convención.
 *  Un cuarto valor cae al `??` de abajo y sale con su clave cruda: nunca
 *  `undefined` ni una etiqueta inventada. */
export const ESTATUS_VIAJE: Record<string, { label: string; estado: Estado }> = {
  abierto: { label: 'Abierto', estado: 'warn' },
  en_cuadre: { label: 'En cuadre', estado: 'warn' },
  liquidado: { label: 'Liquidado', estado: 'ok' },
};

/**
 * La tira de confirmación del chofer (mig. 0058).
 *
 * Los cuatro conteos se calculan SOBRE LAS FILAS QUE SE PINTAN ABAJO, no con
 * una consulta aparte: `getViajes` trae 100 como máximo, y un conteo por otro
 * camino diría un número que no cuadra con la tabla que está debajo. Por eso el
 * subtítulo declara sobre cuántos viajes está contando.
 */
export function TiraConfirmacion({ viajes, ahora }: { viajes: ViajeRow[]; ahora: Date }) {
  const conf = resumenConfirmacion(viajes, ahora);
  return (
    <section className="px-5 pb-5 pt-5 border-t" style={{ borderColor: 'var(--line)' }}>
      <h2 className="text-xs font-semibold uppercase tracking-wide" style={{ color: 'var(--muted)' }}>
        Confirmación del chofer
      </h2>
      <p className="text-xs mt-0.5" style={{ color: 'var(--faint)' }}>
        Sobre los {viajes.length} viaje{viajes.length === 1 ? '' : 's'} listados abajo
      </p>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-3">
        <KpiTile icono={<BellOff width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}
          etiqueta="Sin avisar" valor={conf.sinAvisar} formato="entero"
          destacar={conf.sinAvisar > 0}
          nota="Viajes abiertos sin registro de que el aviso saliera. La escalación automática solo mira viajes avisados: éstos no salen solos, hay que perseguirlos a mano." />
        {/* "Por confirmar" y no "Esperando confirmación": la etiqueta de KpiTile
            recorta con `truncate` y la larga salía cortada en el render. */}
        <KpiTile icono={<BellRing width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--warn)' }} />}
          etiqueta="Por confirmar" valor={conf.esperando} formato="entero"
          nota="Ya se les escribió por WhatsApp y todavía no contestan. La columna de abajo dice hace cuánto." />
        <KpiTile icono={<CheckCheck width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--ok)' }} />}
          etiqueta="Confirmados" valor={conf.confirmados} formato="entero"
          nota="El chofer contestó que sí. La hora exacta va en su renglón." />
        <KpiTile icono={<PhoneOff width={15} height={15} strokeWidth={1.75} style={{ color: 'var(--bad)' }} />}
          etiqueta="Escalados" valor={conf.escalados} formato="entero"
          nota="Pasó el plazo sin respuesta y ya se le avisó al jefe por WhatsApp. Aquí es donde se decide cambiar de chofer." />
      </div>
      {conf.sinRegistro > 0 && (
        <p className="text-xs mt-3" style={{ color: 'var(--faint)' }}>
          {conf.sinRegistro === 1
            ? 'Otro viaje sale como «Sin registro»: ya avanzó a cuadre o quedó liquidado y no guarda la confirmación.'
            : `Otros ${conf.sinRegistro} viajes salen como «Sin registro»: ya avanzaron a cuadre o quedaron liquidados y no guardan la confirmación.`}
          {' '}Las cuatro marcas existen desde la migración 0058 (4-ago-2026); lo anterior a eso no se registró y no se
          puede reconstruir.
        </p>
      )}
    </section>
  );
}

export function TablaViajes({
  viajes, veDinero, ahora,
}: {
  viajes: ViajeRow[];
  veDinero: boolean;
  ahora: Date;
}) {
  if (viajes.length === 0) {
    return (
      <div className="px-5 pb-5">
        <EstadoVacio icono={<Truck width={17} height={17} strokeWidth={1.75} style={{ color: 'var(--marca)' }} />}>
          Aún no hay viajes registrados para esta flota.
        </EstadoVacio>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto mt-1 pb-2">
      <table className="w-full text-sm">
        <thead>
          <tr style={{ color: 'var(--muted)' }} className="text-left">
            <th className="px-5 py-2.5 font-medium">Folio</th>
            <th className="px-5 py-2.5 font-medium">Ruta</th>
            <th className="px-5 py-2.5 font-medium">Operador</th>
            <th className="px-5 py-2.5 font-medium">Confirmación</th>
            <th className="px-5 py-2.5 font-medium">Inicio</th>
            {veDinero && <th className="px-5 py-2.5 font-medium text-right">Anticipo</th>}
            <th className="px-5 py-2.5 font-medium">Estatus</th>
          </tr>
        </thead>
        <tbody>
          {viajes.map((v) => {
            const e = ESTATUS_VIAJE[v.estatus] ?? { label: v.estatus, estado: 'neutral' as Estado };
            const c = confirmacionDeViaje(v, ahora);
            return (
              // `whitespace-nowrap` en folio, fecha y estatus: la columna nueva
              // apretó la tabla y en el render el folio salía partido en tres
              // renglones ("VJ-\n2026-\n1041"). Un folio partido no se puede
              // cruzar de un vistazo contra el papel, que es para lo que está.
              <tr key={v.id} className="border-t align-top" style={{ borderColor: 'var(--line)' }}>
                <td className="px-5 py-3 font-medium whitespace-nowrap">{v.folio}</td>
                <td className="px-5 py-3" style={{ color: 'var(--muted)' }}>
                  {v.origen && v.destino ? `${v.origen} → ${v.destino}` : (v.origen ?? v.destino ?? '—')}
                </td>
                <td className="px-5 py-3">{v.operadorNombre ?? '—'}</td>
                <td className="px-5 py-3">
                  <StatusPill estado={c.estado}>{c.label}</StatusPill>
                  {/* La segunda línea es el DATO (la hora, el tiempo transcurrido,
                      los avisos), no un adorno: sin ella "Esperando confirmación"
                      no dice si van veinte minutos o dos días. */}
                  <div className="text-xs mt-1" style={{ color: 'var(--faint)' }}>{c.detalle}</div>
                </td>
                <td className="px-5 py-3 whitespace-nowrap" style={{ color: 'var(--muted)' }}>{fechaMx(v.fechaInicio)}</td>
                {veDinero && <td className="px-5 py-3 text-right tabular whitespace-nowrap">{v.anticipo > 0 ? mxn(v.anticipo) : '—'}</td>}
                <td className="px-5 py-3 whitespace-nowrap">
                  <StatusPill estado={e.estado}>{e.label}</StatusPill>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
