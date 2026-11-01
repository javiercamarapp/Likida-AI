// Muestrario L7 para capturas (NO es código de producción): las piezas comunes REALES de ui-v2/componentes y los tres formularios
// piloto (Ajustes operativos, Convenio y Cliente) montados con datos sintéticos. Lo empaqueta capturar-l7.mjs con vite.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Info, Search, Download, TriangleAlert } from 'lucide-react';
import { Boton, Casilla, Radio, Switch, Campo, Fieldset, CampoArchivo, SegmentedControl, Tabs, TabsLinea, Tooltip, StatusChip, TablaBase, Icono, Tarjeta } from '@/app/ui-v2/componentes';
import { FormaAjustes } from '@/app/dashboard/configuracion/forma';
import { FormaCliente } from '@/app/dashboard/clientes/forma';
import { FormaImportarConvenios } from '@/app/dashboard/convenios/formas';

const UNIDADES = Array.from({ length: 7 }, (_, i) => ({ id: `U-${100 + i}`, ruta: ['Monterrey → Querétaro', 'Veracruz → Puebla', 'Guadalajara → León'][i % 3], km: 380 + i * 55, estado: (['ok', 'warn', 'bad', 'info', 'neutral', 'muted', 'ok'] as const)[i] }));
const ROTULO = { ok: 'Cuadra', warn: 'Por revisar', bad: 'Rechazada', info: 'En cola', neutral: 'Borrador', muted: 'Sin dato' } as const;

function Muestrario() {
  const [periodo, setPeriodo] = useState('mes');
  const [marcada, setMarcada] = useState(true);
  return (
    <div className="rv-muestra" style={{ display: 'grid', gap: 20, padding: 20, maxWidth: 1180, margin: '0 auto' }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 600 }}>Piezas comunes · lote 7</h1>
      <Tarjeta titulo="Iconos y botones">
        <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap' }}>
          {([14, 16, 18, 20] as const).map((t) => <span key={t} style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><Icono icono={Info} tam={t} />{t}</span>)}
          <Boton>Buscar</Boton>
          <Tooltip texto="Descarga el resumen del periodo en CSV, con las cifras tal como se ven"><button type="button" className="rv-btn rv-btn--secondary" id="demo-tip"><Icono icono={Download} /> Descargar</button></Tooltip>
          <Tooltip texto="Corte al cierre del lunes">Corte semanal</Tooltip>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Segmentado, pestañas y estados">
        <div style={{ display: 'grid', gap: 14 }}>
          <SegmentedControl etiqueta="Periodo" valor={periodo} onChange={setPeriodo} opciones={[{ valor: 'sem', etiqueta: 'Semana' }, { valor: 'mes', etiqueta: 'Mes', conteo: 12 }, { valor: 'tri', etiqueta: 'Trimestre' }, { valor: 'anio', etiqueta: 'Año', deshabilitada: true }]} />
          <TabsLinea etiqueta="Secciones" actual="fuentes" pestanas={[{ clave: 'r', etiqueta: 'Resumen', href: '#r' }, { clave: 'fuentes', etiqueta: 'Fuentes', href: '#f', conteo: 3 }, { clave: 'c', etiqueta: 'Cobertura', href: '#c', conteo: 0 }]} />
          <Tabs etiqueta="Detalle" pestanas={[{ valor: 'a', etiqueta: 'Por decidir', conteo: 4, contenido: <p style={{ margin: 0 }}>Panel con las recomendaciones por decidir.</p> }, { valor: 'b', etiqueta: 'En curso', contenido: <p>En curso</p> }, { valor: 'c', etiqueta: 'Resultados', contenido: <p>Resultados</p> }]} />
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>{(Object.keys(ROTULO) as Array<keyof typeof ROTULO>).map((t) => <StatusChip key={t} tono={t}>{ROTULO[t]}</StatusChip>)}</div>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Campos">
        <div style={{ display: 'grid', gap: 14, gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))' }}>
          <div>
            <Casilla name="a" etiqueta="Recibir avisos por correo" ayuda="Llegan una vez al día" checked={marcada} onChange={(e) => setMarcada(e.target.checked)} />
            <Casilla name="b" etiqueta="Seleccionar todas" indeterminada />
            <Casilla name="c" etiqueta="Bloqueada" disabled />
            <Switch nombre="sw" etiqueta="Activo" defaultChecked />
          </div>
          <Fieldset leyenda="Formato de salida" ayuda="Elige uno">
            <Radio name="fmt" value="csv" etiqueta="CSV" defaultChecked />
            <Radio name="fmt" value="xml" etiqueta="XML" />
            <Radio name="fmt" value="x" etiqueta="Excel" disabled />
          </Fieldset>
          <div style={{ display: 'grid', gap: 12 }}>
            <Campo etiqueta="Nombre del cliente" ayuda="Como aparece en el RFC" error="Falta el nombre" obligatorio><input name="n" /></Campo>
            <CampoArchivo name="f" etiqueta="Documento" ayuda="PDF o imagen" accept=".pdf" />
          </div>
        </div>
      </Tarjeta>
      <Tarjeta titulo="Tabla base">
        <TablaBase etiqueta="Unidades" idFila={(f: (typeof UNIDADES)[number]) => f.id} filas={UNIDADES}
          columnas={[{ id: 'u', titulo: 'Unidad', principal: true, celda: (f: (typeof UNIDADES)[number]) => f.id }, { id: 'r', titulo: 'Ruta', celda: (f: (typeof UNIDADES)[number]) => f.ruta }, { id: 'k', titulo: 'Km', alinear: 'der', celda: (f: (typeof UNIDADES)[number]) => f.km }, { id: 'e', titulo: 'Estado', celda: (f: (typeof UNIDADES)[number]) => <StatusChip tono={f.estado}>{ROTULO[f.estado]}</StatusChip> }]} tarjetaMovil />
      </Tarjeta>
      <Tarjeta titulo="Piloto · Ajustes operativos (Radio + StatusChip)">
        <FormaAjustes inicial={{ rendimientoPorDefecto: '3.2', factorCarga: '1', precioDieselPorDefecto: '24.5', umbralDesviacionPct: '15', salida: 'csv', cuentas: '' }} ejemploKm={900} guardar={async () => null} catalogo="sin_declarar" />
      </Tarjeta>
      <Tarjeta titulo="Piloto · Cliente (Casilla)">
        <FormaCliente accion={async () => null} idPrefijo="demo" inicial={{ nombre: 'Transportes Demo S.A. de C.V.', rfc: '', contacto: '', correo: '', telefono: '', diasCredito: '30', activo: true }} />
      </Tarjeta>
      <Tarjeta titulo="Piloto · Importar convenios (CampoArchivo)">
        <FormaImportarConvenios accion={async () => null} />
      </Tarjeta>
      <p style={{ display: 'none' }}><Search /><TriangleAlert /></p>
    </div>
  );
}
createRoot(document.getElementById('raiz')!).render(<div data-ui="v2" className="tema-neutro"><Muestrario /></div>);
