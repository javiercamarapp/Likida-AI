'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './conocimiento.css';
import { buscarNormas, PUEDE_AFIRMARSE, JERARQUIA_ROTULO, type Norma } from '@/lib/likida/normas/tipos';
import { Aviso, Boton, BotonEnlace, Chip, CampoTexto, Drawer, Icono, SegmentedControl, StatusChip, TablaBase, type ColumnaBase } from '@/app/ui-v2/componentes';
import { EsqueletoTablaMaestra } from '@/app/ui-v2/esqueletos';
import { useT } from '@/lib/i18n/proveedor';
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
    { id: 'rev', titulo: t('cfg.revisada_el'), celda: (n) => <span className="rv-conocimiento__nota">{n.verificado_el ?? t('e26.con_sin_fecha')}</span> },
    { id: 'ver', titulo: '', alinear: 'der', celda: (n) => <Boton variante="ghost" tamano="sm" onClick={() => setAbierta(n.id)} aria-label={`${t('e26.con_ver')}: ${n.titulo ?? n.instrumento}`}>{t('e26.con_ver')}</Boton> },
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
        { etiqueta: t('cfg.fichas'), info: 'conocimiento.ficha', valor: normas.length },
        { etiqueta: t('cfg.se_puede_afirmar'), valor: conteo('afirmables') },
        { etiqueta: t('cfg.sin_verificar'), valor: conteo('sin_verificar'), tono: conteo('sin_verificar') > 0 ? 'warn' : undefined },
      ]}
      etiquetaCifras={t('cfg.fichas')}
      pie={t('e26.con_pie', { n: lista.length, total: normas.length })}
      vistaRapida={(
        <Drawer abierto={elegida !== null} onCerrar={() => setAbierta(null)} titulo={elegida ? (elegida.titulo ?? elegida.instrumento) : t('cfg.fichas')} descripcion={elegida ? elegida.instrumento : undefined} tamano="m"
          pie={elegida?.fuente_url ? (
            <BotonEnlace href={elegida.fuente_url} tamano="sm" variante="primary" target="_blank" rel="noopener noreferrer">{t('cfg.leer_la_fuente')}{' '}<Icono icono={ExternalLink} tam={14} /></BotonEnlace>
          ) : undefined}>
          {elegida ? (
            <div className="rv-conocimiento__detalle">
              <div className="rv-conocimiento__chips">
                <Chip>{JERARQUIA_ROTULO[elegida.jerarquia] ?? `Nivel ${elegida.jerarquia}`}</Chip>
                <StatusChip tono={vElegida?.puede ? 'ok' : 'warn'}>{vElegida?.rotulo ?? elegida.estado_verificacion}</StatusChip>
              </div>
              {elegida.articulo_o_regla ? <p className="rv-conocimiento__instrumento">{`Art./regla ${elegida.articulo_o_regla}`}</p> : null}
              {vElegida ? <p className="rv-conocimiento__nota" data-puede={vElegida.puede || undefined}>{vElegida.nota}</p> : null}
              {elegida.citasEnCodigo.length > 0 ? <p className="rv-conocimiento__nota">{t('cfg.se_aplica_como')}{' '}{elegida.citasEnCodigo.join(' · ')}</p> : null}
              {elegida.verificado_el ? <p className="rv-conocimiento__nota">{t('cfg.revisada_el')}{' '}{elegida.verificado_el}</p> : null}
            </div>
          ) : null}
        </Drawer>
      )}
    >
      <TablaBase
        etiqueta={t('cfg.fichas')} columnas={cols} filas={lista} idFila={(n) => n.id} densa altoMaximo={false} tarjetaMovil
        vacio={{
          titulo: buscando ? t('cfg.ninguna_ficha_habla_de_eso') : t('cfg.no_hay_fichas_con_ese_estado'),
          texto: buscando ? t('cfg.no_se_muestra_la_mas_parecida') : t('cfg.prueba_con_otro_estado_de_verificacion'),
        }}
      />
    </EsqueletoTablaMaestra>
  );
}
