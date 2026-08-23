# Auditoría prod — FRONTEND/UX A ESCALA (22-ago-2026)
## CRÍTICO
- FE-1 /admin: getResumenNegocio (→ S4 ya lo arregló con RPC). Pendiente: getFlotas() ligero para configuracion/usuarios/nuevo; .catch + EstadoError por tarjeta en 17 pages; unstable_cache 60 s.
- FE-2 repo.ts:96-102 listOperadores sin limit (PostgREST 1,000) + despacho/page.tsx:59-69 cliente/unidad; forma-viaje.tsx:87-137 y despacho/acciones.tsx:37-73 un <select> POR FILA (1.5-2 MB HTML hoy; 8-10 MB con traerTodo). Fix: combobox con búsqueda en servidor (?q=, limit 20); un catálogo por página (<datalist>).
## ALTO
- FE-3 operacion.ts:57-67, 461-473 getTableroOperacion/getCargaOperadores viaje y pod enteros (→ S3); operadores/page.tsx:53 getOperadoresDetalle SIN safe → error.tsx; tablero-operacion.tsx:95 carga.map 7,500 <tr>. Fix: in('estatus', vivos); TablaCarga top 20.
- FE-4 analytics.ts:564,621,1324 y fiscal.ts:945 *Series con Promise.all: el modo histórico tumba semanal/mensual; panel-periodo.tsx:84,109,124 y motor-fiscal-periodo.tsx:40 → "No se pudo cargar" en los 3 modos. Fix: Promise.allSettled por modo (→ S1/S2 deben hacerlo).
- FE-5 getViajes(100) = 90 min de operación: actividad.tsx:34-53 ("últimos 7 días"), avance-cierre.tsx:54-74, barra-acciones.tsx:53-71 (búsqueda en memoria), viajes-recientes.tsx:27, mapa/page.tsx:43 + vista.tsx:38, huerfanos/page.tsx:88-91 (re-verificación FALSA "Ese viaje ya no está abierto"), despacho/vista.tsx:177-180, agentes/conductores/vista.tsx:67-70 ("100" literal). Fix: count group by fecha_inicio; búsqueda contra getViajesRegistro(q); huérfanos verificar por id+tenant+estatus; mapa/conductores in('estatus', vivos) con count.
- FE-6 inicio-contenido.tsx:118,186,191 folio→id con getLiquidaciones(50) → link "Ver" perdido. Fix: getLiquidacionesDeViajes(ids) (1 línea).
- FE-7 caen a error.tsx sin safe: operadores/page.tsx:53, agentes/facturas/page.tsx:41-42 (getPorFacturar sin ventana → F2 ESC-12). Error permanente: facturacion/page.tsx:55, rentabilidad:31, combustible-casetas:120-122, agentes/liquidacion:58, clientes:54-57 (→ S1/S3). Fix: safe + EstadoError en las dos que caen.
- FE-8 admin/consumo.ts:56-59 limit 5000 sin order; slo.ts:41; capacidad.ts:42 (→ S4 arregló capacidad). Fix: count head / sum RPC; rótulo "muestra de 1,000".
- FE-9 negocio.ts:359 limit(20) → conversaciones/page.tsx:22-57, agente-whatsapp:47, calcular-alertas.ts:114-117 "activas/totales"; escalaciones.ts:230 getCorridasFallidas(20). Fix: count head + rótulo "20 más recientes".
- FE-10 vendedor/panel-vendedor.tsx:20,107 TOPE_COLUMNA=30 con texto "filtra para verlos" sin filtro en esa pantalla. Fix: ?col=&pag= o búsqueda; texto condicionado.
- FE-11 admin/escalaciones/page.tsx:141-176 bandeja sin tope (negocio.ts:643 → S4 limitó a 200); soporte.ts:58-63 todos los tickets; ficha-cliente.ts:70,91 sin eq tenant. Fix: range+count, top 50; eq('tenant_id').
## MEDIO
- FE-12 catálogos completos con forma cliente por fila: unidades/vista.tsx:144-190 (5,000), operadores/vista.tsx:99-170 (7,500), clientes/vista.tsx:349,421-440 (select de clientes por tarifa), equipo/page.tsx:45,80. Fix: ?p=&q= servidor; una forma de edición por id.
- FE-13 ventanas no declaradas: agentes/liquidacion/vista.tsx:90-98; combustible-casetas:149-196 (→ S5); proveedores/vista.tsx:47-69; huerfanos/vista.tsx:42 (usar contarHuerfanosPendientes); admin/tu-turno/vista.tsx:79; copiloto.tsx:653,698. Fix: count real + "N de M".
- FE-14 cero Suspense en dashboard/admin; inicio-contenido.tsx:86-124 16 consultas; series en serie: proveedores/page.tsx:76-88, admin/crecimiento:36-45, admin/observabilidad:79-100 (kill switch no carga si getResumenNegocio falla), qa/[id]:47-54. Fix: Promise.all donde serie; Suspense por tarjeta; fiscal en su boundary.
- FE-15 importar_viajes.ts:299-325 resuelve catálogos fila a fila; 8 MB ≈ 60-80k filas → timeout a medias. Fix: tope 2,000 filas o catálogos en lote + insert por tandas.
- FE-16 admin/mapa-prospectos/page.tsx:24 + prospectos-mapa.ts:423 + cerebro.tsx:419-434: universo completo (6 MB) al cliente cada 5 min. Fix: listado ligero, textos en [id], delta ?desde=, pausa con visibilityState.
- FE-17 formato-preset.ts:28 'entero' sin separador (42 usos); crudos: flotas/page.tsx:212, consola.tsx:544, vendedores/tablero.tsx:215, rentabilidad/vista.tsx:69,72, combustible-casetas:183-196, viajes/importar.tsx:68-100, contador-retro.tsx:102; sin compacto: agentes/liquidacion/vista.tsx:83, despacho/vista.tsx:258-265, mapa/vista.tsx:78-86. Fix: numero(); preset mxnCompacto.
- FE-18 admin/rango-costo.tsx:15 default Todo + charts.tsx:52-112 sin agrupar (1,800 nodos SVG). Fix: agrupar por semana si n>90; default 30d.
- FE-19 tablas sin overflow-x-auto: admin/consumo:109, crecimiento:187, campanas.tsx:49, flotas/[id]/ficha.tsx:134,160, actividad-codigo:101, copiloto.tsx, dashboard/chat.tsx, suscripcion/vista.tsx.
## BAJO
- FE-20 actividad.tsx:20-25 new Date()+toISOString en cliente → mismatch SSR 18:00-24:00 MX; corrida-viva.tsx:61,88; inicio-contenido:80, inicio-contador:66, arco/page.tsx:32 UTC. Fix: hoy como prop (hoyMx); useState(null)+efecto.
- FE-21 aria-label: huerfanos/acciones.tsx:72-76, despacho/acciones.tsx:84,116.
- FE-22 qa/pantalla.tsx:66-128, corrida-viva.tsx:136,167, lanzar-form.tsx:132 US$ toFixed → usd4() en formato.ts.
- FE-23 key={c.telefono} en conversaciones:67, consola:584, whatsapp-infra:87, agente-whatsapp:53 → ${tenantId}-${telefono}.
- FE-24 copiloto.tsx:414-481 fetch sin AbortController; flotas/page.tsx:149 counts PMF por flota (→ ESC-9); dev/page.tsx:33-41 ignora error del count; viajes/libro.tsx código muerto con 4 traerTodo.
