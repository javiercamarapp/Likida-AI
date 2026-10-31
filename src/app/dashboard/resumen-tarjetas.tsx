import { Bell, Flag } from 'lucide-react';
import { fechaCorta, mxnEntero, numero, porcentaje } from '@/lib/formato';
import { BotonEnlace, EstadoVacio, Tarjeta } from '@/app/ui-v2/componentes';
import { BarList, Bullet, Columnas, KindBadge, type ItemKpi } from '@/app/ui-v2/graficas';
import { rotuloDiferencia } from './agentes/liquidacion/rotulo-diferencia';
import { PERIODO_RANGO, RUTA_LIQUIDACION, type DatosResumen } from './resumen-modelo';

/** ¿Este rol (en este perfil) abre esa pantalla? Sin ello el enlace no se ofrece: nunca un KPI que rebota. */
type PuedeRuta = (ruta: string) => boolean;
const siempre: PuedeRuta = () => true;

// Las tarjetas de datos del Resumen v2. Componentes de servidor, puros sobre `DatosResumen`: sin lectura propia, sin cifra
// inventada (null = «—» / «No es cero»).

/** La tira de KPI: una celda por área (DISENO-ACUERDO #9). Sin acceso al dinero, las mismas áreas pero con conteos. */
export function itemsKpi(d: DatosResumen, sufijo: string, puede: PuedeRuta = siempre): ItemKpi[] {
  const enlace = (ruta: string) => (puede(ruta) ? `${ruta}${sufijo}` : undefined);
  const k = d.kpis;
  const periodo = PERIODO_RANGO[d.rango];
  const selloLiq = `Liquidaciones · ${periodo}`;
  const hrefLiq = enlace(RUTA_LIQUIDACION);
  const cp = d.cartaPorte;
  const cartaPorte: ItemKpi = {
    etiqueta: 'Carta Porte completas', metrica: 'cumplimiento_carta_porte', info: 'resumen.carta_porte_completas', href: enlace('/dashboard/agentes/carta-porte'),
    valor: cp === null || cp.total === 0 ? null : cp.completas,
    sello: cp === null ? undefined : cp.total === 0 ? 'Sin viajes abiertos' : `de ${numero(cp.total)} · viajes abiertos`,
    conteo: true,
  };
  const porRevisar: ItemKpi = {
    etiqueta: 'Por revisar', metrica: 'requiere_accion', info: 'resumen.por_firmar', href: hrefLiq,
    valor: k ? k.porRevisar : null, sello: selloLiq, conteo: true,
  };
  if (d.veDinero) {
    const p = d.peajes;
    return [
      { etiqueta: 'Monto comprobado', metrica: 'dinero_comprobado', info: 'resumen.monto_comprobado', href: hrefLiq, valor: k ? mxnEntero(k.montoComprobado) : null, sello: selloLiq },
      porRevisar,
      {
        etiqueta: 'Peajes del periodo', metrica: 'gasto_peajes', info: 'resumen.peajes_periodo', href: enlace('/dashboard/agentes/peajes'),
        valor: p && p.total !== null ? mxnEntero(p.total) : null,
        sello: p && p.total !== null ? `Casetas · ${p.semanas === 1 ? 'semana en curso' : `últimas ${p.semanas} semanas`}` : undefined,
      },
      cartaPorte,
    ];
  }
  return [
    { etiqueta: 'Liquidaciones cerradas', metrica: 'volumen_viajes', info: 'resumen.liquidaciones_cerradas', href: hrefLiq, valor: k ? k.viajesLiquidados : null, sello: selloLiq, conteo: true },
    porRevisar,
    { etiqueta: 'Con diferencias', metrica: 'diferencias_por_cuadrar', info: 'resumen.con_diferencias', href: hrefLiq, valor: k ? k.conDiferencias : null, sello: selloLiq, conteo: true },
    cartaPorte,
  ];
}

export function TarjetaCierres({ d }: { d: DatosResumen }) {
  const c = d.cierres;
  const total = c ? c.reduce((s, x) => s + x.valor, 0) : 0;
  return (
    <Tarjeta
      titulo="Liquidaciones cerradas por semana" info="resumen.cierres_semana" className="rv-res__cierres"
      estado={c === null ? 'error' : 'ok'} reintentar
      acciones={c && total > 0 ? <span className="rv-res__nota">{numero(total)} en {c.length} semanas · la última, en curso</span> : undefined}
    >
      {c ? <Columnas datos={c.map((x) => ({ etiqueta: x.etiqueta, valor: x.valor, parcial: x.parcial, largo: `Semana del ${x.etiqueta}` }))} unidad="cierres" matiz={1} etiqueta="Liquidaciones cerradas por semana, últimas ocho semanas" formato={numero} vacio="Sin liquidaciones cerradas en las últimas ocho semanas" /> : null}
    </Tarjeta>
  );
}

function Dato({ etiqueta, children, sello }: { etiqueta: string; children: React.ReactNode; sello?: React.ReactNode }) {
  return <div className="rv-dato"><dt>{etiqueta}</dt><dd>{children}{sello}</dd></div>;
}

export function TarjetaDiferencias({ d }: { d: DatosResumen }) {
  const k = d.kpis;
  const tipos = d.porTipo ? [...d.porTipo].filter((t) => t.monto > 0).sort((a, b) => b.monto - a.monto).slice(0, 3) : null;
  const tope = tipos && tipos.length ? tipos[0].monto : 1;
  return (
    <Tarjeta titulo={d.veDinero ? 'Diferencias vs recuperado' : 'Diferencias en liquidaciones'} info="resumen.diferencias_recuperado" estado={k === null ? 'error' : 'ok'} reintentar>
      {k ? (
        <>
          <dl className="rv-datos">
            {d.veDinero ? <Dato etiqueta="Diferencia detectada">{mxnEntero(k.diferenciaDetectada)}</Dato> : null}
            {d.veDinero ? <Dato etiqueta="Recuperado" sello={<KindBadge tipo="sin_dato" />}>—</Dato> : null}
            <Dato etiqueta="Con diferencias">{numero(k.conDiferencias)} de {numero(k.viajesLiquidados)}</Dato>
            {!d.veDinero ? <Dato etiqueta="Por revisar">{numero(k.porRevisar)}</Dato> : null}
          </dl>
          <div data-cero-fuente="">
            <Bullet valor={k.viajesLiquidados > 0 ? k.tasaCuadre : null} maximo={100} matiz={3} etiqueta="Cuadre sin diferencias" formato={(v) => porcentaje(v, 0)} />
          </div>
          {d.veDinero ? (
            <div className="rv-res__tipos">
              <p className="rv-res__sub">Dónde más pesa (historial)</p>
              {tipos === null ? <EstadoVacio titulo="No disponible ahora. No es cero." /> : tipos.length === 0 ? <EstadoVacio titulo="Sin diferencias registradas" /> : (
                <BarList etiqueta="Dónde más pesan las diferencias" matiz={6} maximo={tope} formato={mxnEntero}
                  items={tipos.map((t) => ({ clave: t.tipo, etiqueta: rotuloDiferencia(t.tipo), valor: t.monto }))} />
              )}
            </div>
          ) : null}
        </>
      ) : null}
    </Tarjeta>
  );
}

export function TarjetaHizoSolo({ d, sufijo, puede = siempre }: { d: DatosResumen; sufijo: string; puede?: PuedeRuta }) {
  const h = d.hechos;
  return (
    <Tarjeta
      titulo="Lo que hizo solo" info="resumen.lo_que_hizo_solo" estado={h === null ? 'error' : h.length === 0 ? 'vacio' : 'ok'} reintentar
      mensaje={h && h.length === 0 ? 'El agente todavía no ha actuado por su cuenta' : undefined}
      acciones={puede(RUTA_LIQUIDACION) ? <BotonEnlace tamano="sm" variante="ghost" href={`${RUTA_LIQUIDACION}${sufijo}`}>Ver actividad</BotonEnlace> : undefined}
    >
      {h && h.length ? (
        <ul className="rv-solo">
          {h.map((x) => (
            <li key={`${x.tipo}-${x.folio}-${x.cuando}`}>
              <span className="rv-solo__icono" aria-hidden="true">{x.tipo === 'escalado' ? <Flag width={14} height={14} /> : <Bell width={14} height={14} />}</span>
              <span className="rv-solo__texto" title={x.tipo === 'escalado' ? `Viaje ${x.folio} escalado` : `Recordatorio de comprobación${x.operador ? ` a ${x.operador}` : ''}`}>
                {x.tipo === 'escalado' ? <>Escaló el viaje <b className="rv-id">{x.folio}</b></> : <>Recordó comprobar a {x.operador ?? 'un operador'}</>}
              </span>
              <span className="rv-solo__cuando">{fechaCorta(x.cuando)}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </Tarjeta>
  );
}
