import Link from 'next/link';
import { Check, CircleHelp } from 'lucide-react';
import { numero } from '@/lib/formato';
import type { PasoMarcha, GrupoPaso, ResumenMarcha } from '@/lib/likida/puesta_en_marcha';
import { AUTOMATIZACIONES } from '../rutas';
import { MarcoPagina, Tarjeta, BotonEnlace, Icono } from '@/app/ui-v2/componentes';
import { ProgresoAnillo } from '@/app/ui-v2/graficas';
import './arranque.css';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';

const GRUPOS: Array<{ id: GrupoPaso; titulo: string; nota: string; info: InfoClave }> = [
  { id: 'flota', titulo: 'Tu flota y su cuenta', nota: 'Lo que Likida necesita saber de tu empresa antes de hablar con tus choferes.', info: 'arranque.grupo_flota' },
  { id: 'gente', titulo: 'Tu gente y tus camiones', nota: 'Operadores, unidades, patios y quién los corrige.', info: 'arranque.grupo_gente' },
  { id: 'operacion', titulo: 'Tu primera operación', nota: 'El ciclo completo: viaje, ticket por WhatsApp y liquidación.', info: 'arranque.grupo_operacion' },
];

/**
 * LA PUESTA EN MARCHA (W2 «producto»): el checklist guiado de punta a punta. Cada
 * paso sale de una señal REAL del tenant (`puesta_en_marcha.ts`); uno cuya señal no
 * se pudo leer dice «no pude comprobarlo» — nunca un palomeo ni un pendiente
 * inventados.
 */
export function VistaPuestaEnMarcha({ pasos, resumen, puedeAdministrar, hrefAutomatizacion }: {
  pasos: PasoMarcha[];
  resumen: ResumenMarcha;
  /** El dueño hace los pasos de configuración; al jefe se le muestran sin botón. */
  puedeAdministrar: boolean;
  /** Por cada automatización: su href (con sufijo) o null si el rol no la ve. */
  hrefAutomatizacion: Record<string, string | null>;
}) {
  return (
    <MarcoPagina titulo="Puesta en marcha" apoyo="Lo que falta para que tu flota opere sin ayuda, con el estado real de cada paso.">
      <Tarjeta titulo={resumen.completo ? 'Tu flota está lista para operar' : 'Lo que falta para operar sin ayuda'} info="arranque.avance"
        acciones={<span className="rv-ar__nota">{numero(resumen.hechos)} de {numero(resumen.total)} pasos</span>}>
        <div className="rv-ar__avance">
          <ProgresoAnillo valor={resumen.total === 0 ? 0 : Math.round((resumen.hechos / resumen.total) * 100)} etiqueta="Avance de la puesta en marcha" />
          <div className="rv-ar__resumen">
            {resumen.hayDatoFaltante && (
              <p className="rv-ar__aviso">Algunos pasos no se pudieron comprobar en este momento: el avance de arriba es un mínimo, no una medida.</p>
            )}
            {resumen.siguiente && (
              <p className="rv-ar__nota">
                Siguiente: <strong>{resumen.siguiente.titulo}</strong>
                {(puedeAdministrar || !resumen.siguiente.soloDueno) && (
                  <> — <Link href={resumen.siguiente.href} className="rv-ar__enlace">{resumen.siguiente.cta}</Link></>
                )}
              </p>
            )}
          </div>
        </div>
      </Tarjeta>

      {GRUPOS.map((g) => (
        <Tarjeta key={g.id} titulo={g.titulo} info={g.info}>
          <p className="rv-ar__nota-grupo">{g.nota}</p>
          <ol className="rv-ar__pasos">
            {pasos.filter((p) => p.grupo === g.id).map((p) => <Paso key={p.id} p={p} puedeAdministrar={puedeAdministrar} />)}
          </ol>
        </Tarjeta>
      ))}

      <Tarjeta titulo="Las automatizaciones que trabajan con lo que cargaste" info="arranque.automatizaciones">
        <p className="rv-ar__nota-grupo">
          Cada una se activa en tu cuenta con Likida y arranca con tus operadores, unidades y política. Aquí puedes ver su pantalla.
        </p>
        <ul className="rv-ar__lista">
          {AUTOMATIZACIONES.map((a) => {
            const href = hrefAutomatizacion[a.href];
            return (
              <li key={a.href}>
                {href ? <Link href={href} className="rv-ar__enlace">{a.nombre}</Link> : <span>{a.nombre}</span>}
              </li>
            );
          })}
        </ul>
      </Tarjeta>
    </MarcoPagina>
  );
}

function Paso({ p, puedeAdministrar }: { p: PasoMarcha; puedeAdministrar: boolean }) {
  const hecho = p.estado === 'hecho';
  const sinDato = p.estado === 'sin_dato';
  const puedeActuar = puedeAdministrar || !p.soloDueno;
  return (
    <li className="rv-ar__paso">
      <span aria-hidden="true" className="rv-ar__marca" data-estado={p.estado}>
        {hecho ? <Icono icono={Check} tam={14} /> : sinDato ? <Icono icono={CircleHelp} tam={14} /> : null}
      </span>
      <div className="rv-ar__texto">
        <p className="rv-ar__titulo" data-hecho={hecho || undefined}>
          {p.titulo}
          {p.opcional && <span className="rv-ar__opcional">(opcional)</span>}
          <span className="rv-sr">{hecho ? ' — hecho' : sinDato ? ' — no se pudo comprobar' : ' — pendiente'}</span>
        </p>
        <p className="rv-ar__detalle">
          {sinDato ? 'No pude comprobarlo en este momento. ' : ''}{p.detalle}
        </p>
      </div>
      {!hecho && (
        puedeActuar ? (
          <span className="rv-ar__accion"><BotonEnlace href={p.href} variante="secondary" tamano="sm">{p.cta}</BotonEnlace></span>
        ) : (
          <span className="rv-ar__accion rv-ar__quien">Lo hace quien administra</span>
        )
      )}
    </li>
  );
}
