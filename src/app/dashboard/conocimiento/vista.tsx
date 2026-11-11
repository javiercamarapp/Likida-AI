'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './conocimiento.css';
import { buscarNormas, PUEDE_AFIRMARSE, JERARQUIA_ROTULO, type Norma } from '@/lib/likida/normas/tipos';
import { Aviso, Boton, BotonEnlace, Chip, CampoTexto, Drawer, Icono, SegmentedControl, StatusChip, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { useFormato, useT } from '@/lib/i18n/proveedor';
import { resto as restoEs } from '@/lib/i18n/es/resto';

type FiltroEstado = 'todas' | 'afirmables' | 'sin_verificar';

/**
 * CONOCIMIENTO NORMATIVO — de dónde saca Likida el fundamento, y de dónde saca la duda.
 *
 * El contador de una flota necesita saber con qué texto legal se calculó el estímulo de su liquidación: en un producto que emite
 * una opinión con consecuencias económicas, es justo lo que debe poder auditar. La pantalla enseña el ESTADO DE VERIFICACIÓN al
 * mismo nivel que el título: una ficha `sin_verificar` es una sobre la que Likida NO afirma nada, y quien la lea se entera antes
 * de decidir con ella (por eso el estado va en un `StatusChip` con texto, y el filtro «Sin verificar» existe).
 */
export function VistaConocimiento({ normas }: { normas: readonly Norma[] }) {
  const { t } = useT('resto', restoEs);
  const { fechaMx } = useFormato();
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('todas');
  const [abierta, setAbierta] = useState<string | null>(null);

  const porEstado = (n: Norma) => {
    if (estado === 'todas') return true;
    const puede = PUEDE_AFIRMARSE[n.estado_verificacion]?.puede === true;
    return estado === 'afirmables' ? puede : !puede;
  };

  const lista = useMemo(() => {
    const t = q.trim();
    // Sin búsqueda: por jerarquía (la ley primero) y luego por instrumento.
    const base = t === ''
      ? [...normas].sort((a, b) => (a.jerarquia - b.jerarquia) || a.instrumento.localeCompare(b.instrumento, 'es'))
      : buscarNormas(normas, t);
    return base.filter(porEstado);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `porEstado` solo depende de `estado`.
  }, [normas, q, estado]);

  const buscando = q.trim() !== '';
  const conteo = (f: FiltroEstado) =>
    f === 'todas' ? normas.length : normas.filter((n) => (PUEDE_AFIRMARSE[n.estado_verificacion]?.puede === true) === (f === 'afirmables')).length;

  const cols: ColumnaBase<Norma>[] = [
    {
      id: 'norma', titulo: t('e26.con_norma'), principal: true,
      celda: (n) => (
        <span className="rv-conocimiento__norma">
          <strong>{n.titulo ?? n.instrumento}</strong>
          <span className="rv-conocimiento__nota">{n.instrumento}{n.articulo_o_regla ? ` · Art./regla ${n.articulo_o_regla}` : ''}</span>
        </span>
      ),
    },
    { id: 'nivel', titulo: t('e26.con_nivel'), celda: (n) => <Chip>{JERARQUIA_ROTULO[n.jerarquia] ?? `Nivel ${n.jerarquia}`}</Chip> },
    {
      id: 'estado', titulo: t('llaves.estado'),
      celda: (n) => { const v = PUEDE_AFIRMARSE[n.estado_verificacion]; return <StatusChip tono={v?.puede ? 'ok' : 'warn'}>{v?.rotulo ?? n.estado_verificacion}</StatusChip>; },
    },
    { id: 'rev', titulo: t('cfg.revisada_el'), celda: (n) => <span className="rv-conocimiento__nota">{n.verificado_el ? fechaMx(n.verificado_el) : t('e26.con_sin_fecha')}</span> },
    { id: 'ver', titulo: t('e27.con_detalle'), alinear: 'der', celda: (n) => <Boton variante="ghost" tamano="sm" className="rv-conocimiento__ver" onClick={() => setAbierta(n.id)} aria-label={`${t('e26.con_ver')}: ${n.titulo ?? n.instrumento}`}>{t('e26.con_ver')}</Boton> },
  ];
  const elegida = abierta ? normas.find((n) => n.id === abierta) ?? null : null;
  const vElegida = elegida ? PUEDE_AFIRMARSE[elegida.estado_verificacion] : undefined;

  return (
    <EsqueletoTablaMaestra
      titulo={t('cfg.conocimiento_normativo')} apoyo={t('cfg.las_fichas_de_las_que_depende')}
      avisos={<Aviso tono="info">{t('cfg.esto_es_de_donde_sale_el')}</Aviso>}
      filtros={(
        <div className="rv-conocimiento__filtros">
          <CampoTexto
            tipo="search"
            id="norma-q"
            etiqueta={t('cfg.buscar_una_norma')}
            etiquetaOculta
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t('cfg.peaje_20_a_diesel_carta_porte')}
          />
          <SegmentedControl<FiltroEstado>
            etiqueta={t('cfg.estado_de_verificacion')}
            valor={estado}
            onChange={setEstado}
            opciones={[
              { valor: 'todas', etiqueta: t('cfg.todas'), conteo: conteo('todas') },
              { valor: 'afirmables', etiqueta: t('cfg.se_puede_afirmar'), conteo: conteo('afirmables') },
              { valor: 'sin_verificar', etiqueta: t('cfg.sin_verificar'), conteo: conteo('sin_verificar') },
            ]}
          />
        </div>
      )}
      cifras={[
        { etiqueta: t('cfg.fichas'), matiz: 1, info: 'conocimiento.ficha', valor: normas.length },
        { etiqueta: t('cfg.se_puede_afirmar'), matiz: 1, valor: conteo('afirmables') },
        { etiqueta: t('cfg.sin_verificar'), matiz: 1, valor: conteo('sin_verificar'), tono: conteo('sin_verificar') > 0 ? 'warn' : undefined },
      ]}
      etiquetaCifras={t('cfg.fichas')}
      pie={t('e26.con_pie', { n: lista.length, total: normas.length })}
      vistaRapida={(
        <Drawer abierto={elegida !== null} onCerrar={() => setAbierta(null)} titulo={elegida ? (elegida.titulo ?? elegida.instrumento) : t('cfg.fichas')} descripcion={elegida ? elegida.instrumento : undefined} tamano="m"
          pie={elegida ? (
            <div className="rv-esq__vr-pie">
              <Boton variante="secondary" tamano="sm" onClick={() => setAbierta(null)}>{t('e26.con_cerrar')}</Boton>
              {elegida.fuente_url ? (
                <BotonEnlace href={elegida.fuente_url} tamano="sm" variante="suave" target="_blank" rel="noopener noreferrer">{t('cfg.leer_la_fuente')}{' '}<Icono icono={ExternalLink} tam={14} /></BotonEnlace>
              ) : null}
            </div>
          ) : undefined}>
          {elegida ? (
            <div className="rv-conocimiento__detalle">
              <dl className="rv-esq__vr">
                <div><dt>{t('e26.con_nivel')}</dt><dd>{JERARQUIA_ROTULO[elegida.jerarquia] ?? `Nivel ${elegida.jerarquia}`}</dd></div>
                <div><dt>{t('llaves.estado')}</dt><dd>{vElegida?.rotulo ?? elegida.estado_verificacion}</dd></div>
                <div><dt>{t('cfg.revisada_el')}</dt><dd>{elegida.verificado_el ? fechaMx(elegida.verificado_el) : t('e26.con_sin_fecha')}</dd></div>
                <div><dt>{t('e26.con_articulo')}</dt><dd>{elegida.articulo_o_regla ?? '—'}</dd></div>
              </dl>
              {vElegida ? <Aviso tono={vElegida.puede ? 'info' : 'warn'}>{vElegida.nota}</Aviso> : null}
              {elegida.citasEnCodigo.length > 0 ? <p className="rv-conocimiento__nota">{t('cfg.se_aplica_como')}{' '}{elegida.citasEnCodigo.join(' · ')}</p> : null}
            </div>
          ) : null}
        </Drawer>
      )}
    >
      <TablaBase
        etiqueta={t('cfg.fichas')} columnas={cols} filas={lista} idFila={(n) => n.id} altoMaximo={false} tarjetaMovil className="rv-conocimiento__tabla"
        vacio={{
          titulo: buscando ? t('cfg.ninguna_ficha_habla_de_eso') : t('cfg.no_hay_fichas_con_ese_estado'),
          texto: buscando ? t('cfg.no_se_muestra_la_mas_parecida') : t('cfg.prueba_con_otro_estado_de_verificacion'),
        }}
      />
    </EsqueletoTablaMaestra>
  );
}
