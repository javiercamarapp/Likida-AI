import Link from 'next/link';
import { Bell, Flag } from 'lucide-react';
import { numero } from '@/lib/formato';
import type { HechoSolo } from '@/lib/likida/analytics';
import { BotonEnlace, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';
import { BotonReintentar } from '@/app/ui-v2/componentes/boton-reintentar';
import { haceTiempo } from '@/app/ui-v2/datos/sello-dato';
import type { InfoClave } from '@/app/ui-v2/info-catalogo';
import type { CifraExtemporaneos, CifraImporteDecena, CifraPesos } from './cinco-agentes-cifras-modelo';
import type { FichaAgente } from './inicio-cinco-fichas';
import { cuandoMx, pesosCompletos, TONO_SELLO, type CifraAgente, type EstadoAgente } from './inicio-cinco-modelo';
import { conSufijo } from './resumen-modelo';
import { type TResto, T_RESTO_ES } from '@/lib/i18n/resto_tr';

// Piezas PRESENTACIONALES del Inicio de `cinco_agentes`: reciben datos ya leídos (sin lectura propia, sin hooks), así las pruebas y las
// capturas las montan con datos sintéticos. Solo componentes v2; ningún color propio.

const INFO_AGENTE: Record<string, InfoClave> = {
  liquidacion: 'inicio.agente_liquidacion', peajes: 'inicio.agente_peajes', carta_porte: 'inicio.agente_carta_porte',
  vigia: 'inicio.agente_vigia', conductor: 'inicio.agente_conductor',
};
const TITULO_CORTO: Record<string, string> = {
  liquidacion: 'Liquidaciones', peajes: 'Peajes', carta_porte: 'Carta Porte', vigia: 'Servicio al cliente', conductor: 'Operadores',
};

export function TarjetaAgente({ ficha, estado, cifra, href, sufijo, t = T_RESTO_ES }: {
  ficha: FichaAgente; estado: EstadoAgente; cifra: CifraAgente;
  /** Ruta del agente SOLO si el rol la abre (`puedeVerRuta`); sin ella no hay enlace. */
  href: string | null; sufijo: string; t?: TResto;
}) {
  return (
    <Tarjeta titulo={TITULO_CORTO[ficha.clave] ?? ficha.nombre} info={INFO_AGENTE[ficha.clave]} className="rv-ic__agente" elevar entra="tarjeta">
      <div data-agente-resumen={ficha.clave} className="rv-ic__agente-cuerpo">
        <p className="rv-ic__estado">
          <ficha.Icono width={16} height={16} strokeWidth={1.75} aria-hidden="true" />
          <StatusChip tono={estado.punto}>{estado.texto}</StatusChip>
        </p>
        <p className="rv-ic__cifra-fila">
          <span className="rv-ic__cifra" data-vacio={cifra.valor === null || undefined}>{cifra.valor ?? '—'}</span>
          <span className="rv-ic__nota">{cifra.etiqueta}</span>
        </p>
        {cifra.nota ? <p className="rv-ic__nota">{cifra.nota}</p> : null}
        {cifra.error ? <BotonReintentar contexto={ficha.nombre} /> : null}
        {href ? <Link href={conSufijo(href, sufijo)} className="rv-ic__enlace">{t('op.abrir_2')}{' '}{TITULO_CORTO[ficha.clave] ?? ficha.nombre}</Link> : null}
      </div>
    </Tarjeta>
  );
}

function PieSello({ c, leidoEn, ahora, t = T_RESTO_ES }: { c: CifraPesos; leidoEn: string; ahora: number; t?: TResto }) {
  const leidoMs = Date.parse(leidoEn);
  const edad = Number.isFinite(leidoMs) ? haceTiempo(leidoMs, ahora) : null;
  return <p className="rv-ic__nota">{t('op.fuente', { fuente: c.fuente })}{edad ? t('op.leido', { edad }) : ''}</p>;
}

function Avisos({ c, t = T_RESTO_ES }: { c: CifraPesos; t?: TResto }) {
  return (
    <>
      {c.decenasFaltantes.map((f) => <StatusChip key={f} tono="warn">{t('op.falta_cargar')}{' '}{f}</StatusChip>)}
      {c.decenasSinCruces.map((f) => <StatusChip key={f} tono="warn">{t('op.archivo_sin_cruces')}{' '}{f}</StatusChip>)}
    </>
  );
}

/** Sin dato por fallo: error blando con Reintentar. Sin dato porque no hay archivo: vacío con el motivo. Nunca $0. */
function SinValor({ titulo, info, c, t = T_RESTO_ES }: { titulo: string; info: InfoClave; c: CifraPesos; t?: TResto }) {
  return c.reintentar
    ? <Tarjeta titulo={titulo} info={info} estado="error" reintentar mensaje={c.motivo ?? t('op.no_se_pudo_leer_el_estado')} />
    : <Tarjeta titulo={titulo} info={info} estado="vacio" mensaje={t('op.sin_dato_2')} detalle={c.motivo ?? t('op.todavia_no_hay_estado_de_cuenta')} />;
}

export function TarjetaImporteIave({ c, leidoEn, ahora, t = T_RESTO_ES }: { c: CifraImporteDecena; leidoEn: string; ahora: number; t?: TResto }) {
  if (c.valor === null) return <SinValor t={t} titulo={t('op.importe_iave_por_decena')} info="inicio.importe_iave" c={c} />;
  return (
    <Tarjeta titulo={t('op.importe_iave_por_decena')} info="inicio.importe_iave" acciones={<span className="rv-res__nota">{t('op.solo_dueno_y_finanzas')}</span>} className="rv-ic__pesos" elevar entra="tarjeta">
      <p className="rv-ic__cifra-fila">
        <span className="rv-ic__cifra" data-pesos="">{pesosCompletos(c.valor)}</span>
        <StatusChip tono={TONO_SELLO[c.sello]}>{c.sello}</StatusChip>
      </p>
      <p className="rv-ic__nota">{c.periodo}{c.cruces !== null ? ` · ${numero(c.cruces)} cruces` : ''}</p>
      {c.anterior ? <p className="rv-ic__nota">{t('op.decena_anterior', { pesosCompletos: pesosCompletos(c.anterior.valor) })}{' '}{c.anterior.rotulo}</p> : null}
      {/* Faltantes y archivos sin cruces UNA vez: el rótulo ya los dice cuando es Estimado; si es Medido salen como chips. */}
      {c.sello === 'Estimado' ? <p className="rv-ic__nota">{c.rotulo}</p> : <Avisos t={t} c={c} />}
      <PieSello t={t} c={c} leidoEn={leidoEn} ahora={ahora} />
    </Tarjeta>
  );
}

export function TarjetaExtemporaneos({ c, leidoEn, ahora, t = T_RESTO_ES }: { c: CifraExtemporaneos; leidoEn: string; ahora: number; t?: TResto }) {
  if (c.valor === null) return <SinValor t={t} titulo={t('op.cobros_extemporaneos')} info="inicio.extemporaneos" c={c} />;
  return (
    <Tarjeta titulo={t('op.cobros_extemporaneos')} info="inicio.extemporaneos" acciones={<span className="rv-res__nota">{t('op.candidatos')}</span>} className="rv-ic__pesos" elevar entra="tarjeta">
      <p className="rv-ic__cifra-fila">
        <span className="rv-ic__cifra" data-pesos="">{pesosCompletos(c.valor)}</span>
        <StatusChip tono={TONO_SELLO[c.sello]}>{c.sello}</StatusChip>
      </p>
      {/* El rótulo trae el conteo de candidatos, el periodo y las decenas faltantes: UNA sola vez. */}
      <p className="rv-ic__nota">{c.rotulo}</p>
      <PieSello t={t} c={c} leidoEn={leidoEn} ahora={ahora} />
    </Tarjeta>
  );
}

export function TarjetaHizoSolo24({ hechos, ahora, hrefLiquidacion, t = T_RESTO_ES }: { hechos: readonly HechoSolo[] | null; ahora: number; hrefLiquidacion: string | null; t?: TResto }) {
  const acciones = hrefLiquidacion ? <BotonEnlace tamano="sm" variante="ghost" href={hrefLiquidacion}>{t('op.ver_actividad')}</BotonEnlace> : undefined;
  if (hechos === null) return <Tarjeta titulo={t('op.lo_que_hizo_solo')} info="inicio.hizo_solo" estado="error" reintentar acciones={acciones} />;
  if (hechos.length === 0) {
    return <Tarjeta titulo={t('op.lo_que_hizo_solo')} info="inicio.hizo_solo" estado="vacio" contenida mensaje={t('op.nada_en_las_ultimas_24_h')} detalle={t('op.el_agente_no_escalo_ni_recordo')} acciones={acciones} />;
  }
  return (
    <Tarjeta titulo={t('op.lo_que_hizo_solo')} info="inicio.hizo_solo" acciones={acciones}>
      <p className="rv-ic__nota">{t('op.ultimas_24_h')}</p>
      <ul className="rv-solo">
        {hechos.map((x) => (
          <li key={`${x.tipo}-${x.folio}-${x.cuando}`}>
            <span className="rv-solo__icono" aria-hidden="true">{x.tipo === 'escalado' ? <Flag width={14} height={14} strokeWidth={1.75} /> : <Bell width={14} height={14} strokeWidth={1.75} />}</span>
            <span className="rv-solo__texto">
              {x.tipo === 'escalado' ? <>{t('op.escalo_el_viaje')}{' '}<b className="rv-id">{x.folio}</b></> : <>{t('op.recordo_comprobar_a')}{' '}{x.operador ?? 'un operador'}</>}
            </span>
            <span className="rv-solo__cuando">{cuandoMx(x.cuando, ahora)}</span>
          </li>
        ))}
      </ul>
    </Tarjeta>
  );
}

export function TarjetaAtajos({ atajos, sufijo, t = T_RESTO_ES }: { atajos: ReadonlyArray<{ href: string; nombre: string }>; sufijo: string; t?: TResto }) {
  if (atajos.length === 0) return null;
  return (
    <Tarjeta titulo={t('op.atajos')} info="inicio.atajos" className="rv-ic__atajos">
      <ul className="rv-ic__atajos-lista">
        {atajos.map((a) => <li key={a.href}><BotonEnlace tamano="sm" variante="secondary" href={conSufijo(a.href, sufijo)}>{a.nombre}</BotonEnlace></li>)}
      </ul>
    </Tarjeta>
  );
}
