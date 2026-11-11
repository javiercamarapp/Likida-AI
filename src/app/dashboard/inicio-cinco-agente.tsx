import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { BotonReintentar } from '@/app/ui-v2/componentes/boton-reintentar';
import { IconoAgente, type ClaveIconoAgente } from '@/app/ui-v2/componentes/icono-agente';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import type { TrOperacion } from '@/lib/i18n/operacion_tr';
import { TR_OPERACION_ES } from '@/lib/i18n/operacion_tr';
import type { FichaAgente } from './inicio-cinco-fichas';
import type { FaseAgente } from './inicio-cinco-fase';
import type { CifraAgente, EstadoAgente } from './inicio-cinco-modelo';
import { conSufijo } from './resumen-modelo';

// La tarjeta de UN agente en el Inicio de `cinco_agentes`: icono SVG animado (se mueve solo si el agente está corriendo), su estado
// REAL en texto, la cifra con su fuente y, mientras no ha arrancado, QUÉ falta para que arranque. Presentacional: recibe todo ya leído.

const INFO_AGENTE: Record<string, InfoClave> = {
  liquidacion: 'inicio.agente_liquidacion', peajes: 'inicio.agente_peajes', carta_porte: 'inicio.agente_carta_porte',
  vigia: 'inicio.agente_vigia', conductor: 'inicio.agente_conductor',
};
const TITULO_CORTO: Record<string, string> = {
  liquidacion: 'Liquidaciones', peajes: 'Peajes', carta_porte: 'Carta Porte', vigia: 'Servicio al cliente', conductor: 'Operadores',
};
const ESPERA_CON_TEXTO = ['liquidacion', 'peajes', 'conductor'] as const;

export function TarjetaAgenteV3({ ficha, estado, fase, cifra, href, sufijo, tr = TR_OPERACION_ES }: {
  ficha: FichaAgente; estado: EstadoAgente; fase: FaseAgente; cifra: CifraAgente;
  /** Ruta del agente SOLO si el rol la abre (`puedeVerRuta`); sin ella no hay enlace. */
  href: string | null; sufijo: string; tr?: TrOperacion;
}) {
  const clave = ficha.clave as ClaveIconoAgente;
  const titulo = TITULO_CORTO[ficha.clave] ?? ficha.nombre;
  const esperaTexto = fase === 'espera' && (ESPERA_CON_TEXTO as readonly string[]).includes(ficha.clave)
    ? tr.t(`ini5a.espera.${ficha.clave}` as 'ini5a.espera.peajes') : null;
  const textoEstado = fase === 'corriendo' ? tr.t('ini5a.fase.corriendo') : esperaTexto ?? estado.texto;
  const tono = fase === 'corriendo' ? 'ok' : fase === 'espera' ? 'warn' : estado.punto;
  // Mientras el agente no ha corrido nunca (o no se sabe), se dice QUÉ lo hace arrancar. Es el disparador del agente, no un dato medido.
  const diceCuandoArranca = fase === 'sin_corridas' || fase === 'espera';
  return (
    <Tarjeta titulo={titulo} info={INFO_AGENTE[ficha.clave]} className="rv-ic__agente" elevar entra="tarjeta">
      <div data-agente-resumen={ficha.clave} data-fase={fase} className="rv-ic__agente-cuerpo">
        <p className="rv-ic__estado">
          <span className="rv-ic__icono" data-fase={fase}><IconoAgente agente={clave} tam={20} vivo={fase === 'corriendo'} /></span>
          <StatusChip tono={tono}>{textoEstado}</StatusChip>
        </p>
        <p className="rv-ic__cifra-fila">
          <span className="rv-ic__cifra" data-vacio={cifra.valor === null || undefined}>{cifra.valor ?? '—'}</span>
          <span className="rv-ic__nota">{cifra.etiqueta}</span>
        </p>
        {cifra.nota ? <p className="rv-ic__nota">{cifra.nota}</p> : null}
        {diceCuandoArranca ? (
          <p className="rv-ic__falta"><b>{tr.t('ini5a.falta.titulo')}</b>{' '}{tr.t(`ini5a.falta.${ficha.clave}` as 'ini5a.falta.peajes')}</p>
        ) : null}
        {cifra.error ? <BotonReintentar contexto={ficha.nombre} /> : null}
        {href ? (
          <Link href={conSufijo(href, sufijo)} className="rv-ic__enlace">
            {tr.t('ini5a.abrir')}<span className="rv-sr">{' '}{titulo}</span><ArrowRight width={14} height={14} strokeWidth={1.75} aria-hidden="true" />
          </Link>
        ) : null}
      </div>
    </Tarjeta>
  );
}
