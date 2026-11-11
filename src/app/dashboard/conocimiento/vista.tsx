'use client';

import { useMemo, useState } from 'react';
import { ExternalLink } from 'lucide-react';
import './conocimiento.css';
import { buscarNormas, PUEDE_AFIRMARSE, JERARQUIA_ROTULO, type Norma } from '@/lib/likida/normas/tipos';
import { Aviso, BotonEnlace, Chip, CampoTexto, Icono, MarcoPagina, SegmentedControl, StatusChip, Tarjeta } from '@/app/ui-v2/componentes';

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
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState<FiltroEstado>('todas');

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

  return (
    <MarcoPagina titulo="Conocimiento normativo" apoyo="Las fichas de las que depende una cifra de tu liquidación, cada una con su estado de verificación en la fuente original.">
      <Aviso tono="info">
        Esto es de dónde sale el cálculo, no asesoría fiscal. Likida prepara y te señala; la decisión, y su firma, es de tu contador.
      </Aviso>

      <div className="rv-conocimiento__filtros">
        <CampoTexto
          tipo="search"
          id="norma-q"
          etiqueta="Buscar una norma"
          etiquetaOculta
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="peaje, 20-A, diésel, carta porte, datos personales…"
        />
        <SegmentedControl<FiltroEstado>
          etiqueta="Estado de verificación"
          valor={estado}
          onChange={setEstado}
          opciones={[
            { valor: 'todas', etiqueta: 'Todas', conteo: conteo('todas') },
            { valor: 'afirmables', etiqueta: 'Se puede afirmar', conteo: conteo('afirmables') },
            { valor: 'sin_verificar', etiqueta: 'Sin verificar', conteo: conteo('sin_verificar') },
          ]}
        />
      </div>

      {lista.length === 0 ? (
        <Tarjeta titulo="Fichas" info="conocimiento.ficha" estado="vacio" mensaje={buscando ? 'Ninguna ficha habla de eso' : 'No hay fichas con ese estado'}
          detalle={buscando
            ? 'No se muestra la más parecida a propósito: en materia fiscal, una respuesta aproximada es peor que ninguna. Si Likida debería saberlo, dínoslo desde el Centro de ayuda.'
            : 'Prueba con otro estado de verificación.'} />
      ) : (
        lista.map((n) => {
          const v = PUEDE_AFIRMARSE[n.estado_verificacion];
          return (
            <Tarjeta
              key={n.id}
              titulo={n.titulo ?? n.instrumento}
              info="conocimiento.ficha"
              acciones={
                <>
                  <Chip>{JERARQUIA_ROTULO[n.jerarquia] ?? `Nivel ${n.jerarquia}`}</Chip>
                  <StatusChip tono={v?.puede ? 'ok' : 'warn'}>{v?.rotulo ?? n.estado_verificacion}</StatusChip>
                </>
              }
            >
              <p className="rv-conocimiento__instrumento">
                {n.instrumento}
                {n.articulo_o_regla ? ` · Art./regla ${n.articulo_o_regla}` : ''}
              </p>
              {v ? <p className="rv-conocimiento__nota" data-puede={v.puede || undefined}>{v.nota}</p> : null}
              {n.citasEnCodigo.length > 0 ? <p className="rv-conocimiento__nota">Se aplica como: {n.citasEnCodigo.join(' · ')}</p> : null}
              <div className="rv-conocimiento__pie">
                {n.fuente_url ? (
                  <BotonEnlace href={n.fuente_url} tamano="sm" variante="secondary" target="_blank" rel="noopener noreferrer">
                    Leer la fuente <Icono icono={ExternalLink} tam={14} />
                  </BotonEnlace>
                ) : null}
                {n.verificado_el ? <span className="rv-conocimiento__nota">Revisada el {n.verificado_el}</span> : null}
              </div>
            </Tarjeta>
          );
        })
      )}
    </MarcoPagina>
  );
}
