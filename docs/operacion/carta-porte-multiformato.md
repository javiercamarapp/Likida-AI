# Carta Porte multi-formato (Agente 3)

Estado: construido y probado con documentos **sintéticos** y dobles del modelo. NO está probado con documentos reales de clientes (bloqueo externo, ver el final).
Migraciones: `0420` (tablas, bucket, claim, retención), `0421` (roles de modelo), `0640`-`0642` (worker) y `0670`-`0671` (partir un Excel con varios embarques). Código: `src/lib/likida/carta_porte_docs/`. Pantallas: `/dashboard/carta-porte/documentos`.

## Qué hace

Un cliente grande manda la carga en su propio formato. El agente lo recibe, lo lee, una **persona revisa lado a lado y aprueba**, y de lo aprobado salen (a) el viaje con sus mercancías en el formato interno de Likida y (b) la exportación CSV/JSON al formato destino. **No timbra**: un documento de cliente, aunque lo apruebe un humano, produce un borrador; emitir el complemento sigue siendo el acto separado de siempre (una prueba verifica que el módulo no importa nada del camino del timbre).

```
canal (manual · correo cp-<token> · WhatsApp)
   → recibirDocumento      detecta el formato por BYTES, guarda con huella (mismo archivo = mismo documento)
   → procesarDocumento     claim con lease → contenido → [XML | perfil | modelo + escalamiento] → validación
   → bandeja               revisión lado a lado · corregir/confirmar · aprobar (revalida en el servidor)
   → salida                viaje + viaje_mercancia + borrador del complemento (checklist y validadores existentes)
   → exportación           CSV/JSON por mapeo configurable · métricas
```

## Formatos

| Formato | Cómo se lee |
|---|---|
| XML con complemento Carta Porte (2.0/3.0/3.1) | Por código, sin modelo (confianza 0.99). Rechaza `<!ENTITY` (XXE / billion laughs). |
| PDF con texto | `pdf-parse` (≤ 20 páginas) → texto → perfil o modelo. |
| PDF escaneado | Sin capa de texto → se rinde a imagen (≤ 3 páginas) → modelo de visión. |
| Foto | `sharp` orienta y reduce a ≤ 1800 px (límite de píxeles contra bombas) → modelo de visión. HEIC se rechaza con instrucciones. |
| Excel / CSV | Tabla (≤ 5 hojas, 2,000 filas) → perfil o modelo. Las fórmulas **no** se evalúan; el CSV se lee como texto (el CP «01000» no pierde su cero). |
| Correo (.eml, texto o HTML) | Texto; los adjuntos de un `.eml` no se abren (se suben por separado). |

El formato se decide por los bytes, nunca por la extensión ni el `mime` declarado. Tope 12 MB.

## Canales

1. **Carga manual** — formulario de la bandeja (cliente opcional para reconocer su formato).
2. **Correo firmado por flota** — `cp-<token>@<dominio de correo>`; comparte el webhook de Resend del buzón de facturas (`/api/correo/entrante`). «Firmado» = (a) la firma Svix del webhook se verifica **antes** de leer el cuerpo, (b) la flota sale del token del **destinatario**, nunca del remitente. La flota puede declarar los remitentes de sus clientes; uno fuera de la lista entra igual, marcado «remitente no reconocido». Reintentos de Resend: claim por `email_id` + huella del documento = idempotente. Descarga de adjuntos caída = 503 (vuelve), formato ilegible o adjunto > 8 MB = ignorado (200).
   *Interpretación:* el encargo decía «correo firmado por flota»; se implementó como arriba. Si el cliente de demo espera otra cosa (p. ej. un SFTP o una API firmada como la de peajes), es una pieza aparte.
3. **WhatsApp** — la oficina (usuario identificado que puede despachar) reenvía el documento al número de Likida. Solo en flotas que activaron el buzón. Un PDF/Excel/XML con Carta Porte entra solo; una foto debe llevar el pie «carta porte» o «embarque»; un XML que no es Carta Porte (factura de proveedor) sigue su camino. La respuesta sale por `avisarOficina` → `enviarConFallback` (ventana de 24 h → texto; fuera → plantilla `aviso_operacion_v1`, ya en el catálogo; no se añadió plantilla nueva).

## El extractor

Orden de preferencia, de barato a caro: **XML → perfil del cliente → modelo nivel 1 → escalamiento**. Roles en `models.ts`: `cartaporte_extractor` (Gemini 3.5 Flash-Lite) → `cartaporte_extractor_escala` (Gemini 3.8 Flash) → `cartaporte_extractor_escala2` (Sonnet 5.5), todos por env (`LIKIDA_MODEL_CARTAPORTE_*`), con precio en `PRICES` y respaldo cruzado de proveedor.

- Salida estructurada validada con zod (claves cerradas = los campos del complemento; confianza 0-1; evidencia literal).
- **Confianza por campo.** Se escala si un campo crítico sale < 0.80, si faltan dos o más críticos o si no hay mercancías. Dos modelos que coinciden **suben** la confianza (+0.05); si discrepan, **baja** a ≤ 0.6 y el campo cae a revisión.
- **Anclaje**: en documentos con texto, un valor o una evidencia que el documento no contiene baja la confianza (≤ 0.5/0.6): defensa contra lecturas inventadas.
- Presupuesto: el de IA del tenant (`createLlmBudget`), carril `interactivo` (manual/WhatsApp) u `ocr_lote` (correo).

## Seguridad: instrucciones dentro del documento

El documento es dato no confiable. Capas (ninguna depende de que el modelo «se porte bien»): el modelo no tiene herramientas (solo devuelve JSON de esquema cerrado, así que lo peor es un **valor** falso, nunca una acción); el documento va entre marcadores aleatorios por llamada y el sistema le dice que es información; se **detecta** el texto con forma de instrucción (`inyeccion.ts`) → `riesgo_inyeccion`: ningún campo crítico se aprueba sin confirmación humana uno por uno y **de ese documento el perfil no aprende**; un valor extraído que parece una orden bloquea hasta que una persona lo escriba.

## Validación y bloqueo

`validacion.ts`: **bloqueo** (falta un crítico o no puede ser verdad: RFC mal formado/fecha imposible, CP inexistente, clave fuera de rango, peso > 80 t…), **confirmar** (puede ser verdad pero hay duda: confianza baja, dígito verificador del RFC, CP ≠ estado, pesos que no suman, cantidad ≠ peso, documento con instrucciones…) y **aviso** (informativo: posible duplicado por folio, viaje ya existente, remitente no reconocido…). Crítico = RFC y CP de origen/destino, y por mercancía descripción, clave de producto, cantidad, unidad y peso. Corregir ≠ confirmar: solo corregir cuenta en la métrica.

**Límite honesto de los catálogos SAT:** c_Estado va completo; **c_ClaveUnidad es un subconjunto** (11 claves de uso común); c_ClaveProdServCP, c_CodigoPostal, c_TipoEmbalaje y c_FraccionArancelaria **no están embebidos**: se valida forma/rango y el CP contra su estado por prefijo (aproximación). El PAC valida contra el catálogo completo al timbrar. Cargar los catálogos completos solo cambia `catalogos.ts`.

## Perfil por cliente-formato

Mapeo declarativo (columna / etiqueta / ruta XML / constante) con el separador de miles propio del cliente. Se aprende **solo de lo que un humano aprobó** (y nunca de un documento con instrucciones); aprender crea la **versión siguiente** (las versiones son inmutables: trigger en la base) y volver atrás solo mueve `version_activa`. Se reaplica sin modelo; el modelo solo completa lo que falte (el perfil gana en lo que ya dio). Límite: un Excel con **varios embarques** (una fila por embarque) lee el primero y avisa; un documento = un embarque. Fotos y escaneos no aprenden (no hay columnas ni etiquetas).

## El worker de la bandeja (cron `carta-porte-docs`, 0640-0642)

`/api/cron/carta-porte-docs`, cada 5 minutos (puerta `CRON_SECRET`, palancas `global` y `agente:carta_porte` fail-closed, latido en todo camino de salida). Lo que antes dependía de que la petición que recibió el documento alcanzara el reloj (o de que alguien apretara «Procesar») ahora lo hace el cron:

- **Elige** con `cp_documentos_pendientes`: recibidos con más de 2 min (gracia para la petición que los recibió), de lease vencido y fallidos con **espera creciente** (15, 30, 60, 120 min según los intentos). **Procesa** con `procesarDocumento`, que reclama con `cp_documento_reclamar` (lease 120 s, tope de 5 intentos): dos corridas solapadas no extraen —ni le pagan al modelo— dos veces.
- **Estado terminal**: `fallido` con 5 intentos (un archivo ilegible los agota de inmediato). Nadie lo reclama más; queda visible en la bandeja con su `ultimo_error`. El presupuesto de IA agotado **no gasta intentos** y para la pasada; cuatro fallos de modelo seguidos también (y alertan al operador).
- **Avisa a la oficina** (jefe de tráfico, `avisarOficina`: texto o plantilla `aviso_operacion_v1`) **una vez por documento y tipo** con el candado `cp_documento_reclamar_aviso` (no sube `version`): `hallazgos` (llegó por correo y quedó por revisar con un bloqueo o confianza menor al umbral crítico) y `agotado` (no se pudo leer). El texto lleva el nombre del archivo, conteos y la liga; nunca valores de los campos extraídos. Máximo 10 por pasada.
- **Regla del outbox**: un rechazo reintentable de Meta (timeout, 429, 5xx) YA dejó el aviso en `wa_outbox`; el candado se queda cerrado y no se reenvía. Solo un rechazo definitivo (plantilla sin aprobar) suelta el candado.
- **Sin migrar**: contra una base sin la 0641 la elección cae a una consulta directa con la misma regla y los avisos quedan apagados (sin candado atómico se repetirían); el latido sale `parcial`. Sin la 0642 el latido no se registra y los eventos `aviso_oficina`/`reintentos_agotados` no se escriben (mejor esfuerzo).
- No sustituye a la revisión humana: el cron solo extrae y avisa; aprobar sigue siendo de una persona.

## Un Excel con varios embarques (0670-0671, P13)

Un documento de Carta Porte es **un** embarque. Un Excel/CSV con N folios se **parte en N documentos hijos** en lugar de leer el primero y avisar «sube el resto por separado» (los demás se perdían en silencio). `carta_porte_docs/multiembarque.ts` (puro) + `procesarDocumento`:

- **Detección, antes de gastar un token.** La columna del folio es la que el **perfil** del cliente ya mapea a `folio_cliente`; sin perfil, solo una cabecera **inequívoca** («Folio», «Folio embarque», «Embarque», «Shipment»…). Nombres ambiguos («Pedido», «Referencia», «Orden») NO se adivinan: pueden traer un valor distinto por renglón de un mismo embarque. Se agrupa por folio (sin distinguir mayúsculas ni espacios; una celda vacía hereda el folio de arriba; las filas de TOTALES no son de ningún embarque). Con 1 folio no se hace nada; con más de 100 no se parte y la lectura lo avisa.
- **Los hijos.** Cada embarque es un CSV derivado (cabecera + sus filas, determinista, con inicio de fórmula neutralizado) con **su propia huella sha256**; todos comparten la **huella base** (el sha256 del archivo original) en `cp_documento_embarque` junto con `padre_id`, `indice`/`total` y el folio (`clave`). Cada hijo nace `recibido` con el canal, el remitente y el cliente del original, y sigue el camino de siempre: lo lee el cron (o el correo/WhatsApp si alcanza el reloj), se revisa y aprueba **por embarque** y produce **su** viaje.
- **El original** queda `dividido` (constancia, sin revisión ni modelo; retención 90 d, la de lo «cerrado»). Nadie lo reclama (`cp_documento_reclamar` y `cp_documentos_pendientes` no toman `dividido`) y las métricas no lo cuentan: se miden los embarques.
- **Atomicidad e idempotencia (0671).** `cp_documento_dividir` crea los hijos, las fichas, los eventos y marca al padre en UNA transacción, y solo si el documento sigue `procesando` con la versión que el worker reclamó. Re-dividir un padre ya dividido devuelve sus hijos sin crear nada. Una huella que ya existía en la flota (alguien subió antes ese embarque suelto, o un Excel corregido que repite embarques sin cambios) **no se duplica ni se le cuelga linaje ajeno**: el evento `dividido` dice cuántos eran nuevos y cuántos ya existían.
- **Pantallas.** La bandeja etiqueta cada hijo «Embarque i de N · folio X» y el original «Dividido en embarques»; el detalle del original lista sus embarques con su estado y el de un hijo enlaza de regreso. WhatsApp contesta «trae N embarques: lo separé en N documentos».
- **ARCO.** Eliminar un original dividido borra primero cada hijo **con su archivo en Storage** y al final el original (la base solo arrastra las fichas de linaje, no los documentos hijos: una cascada de filas dejaría los archivos huérfanos).
- **Sin migrar.** Contra una base sin la 0670/0671 (`cp_documento_dividir` no existe) el código lee el primer embarque con el aviso de siempre y la bandeja no muestra etiquetas: no se pierde ningún documento. Sin la 0670 la lectura del linaje devuelve vacío.
- **Lo que no hace.** No parte PDF, foto, XML ni correo con varios embarques (el modelo sigue extrayendo el primero y lo dice en `notas`); no une los viajes de los hijos ni asigna operador por ti (la base admite un viaje abierto por operador: cada embarque se aprueba con SU operador). Pruebas: `multiembarque.test.ts`, `servicio_multiembarque.test.ts`, `repo_division.test.ts`, el bloque «multi-embarque» de `e2e/agente-03-carta-porte.e2e.test.ts`, `supabase/tests/0670_cp_documento_dividir.sql` y el bloque 310 de `verificaciones.sql`.

## Revisión

Documento al lado de lo leído (imagen, páginas del escaneo o texto), todos los campos del complemento (también los vacíos), confianza, origen y evidencia por campo, motivo de cada bloqueo/duda. Candado optimista por `version`: dos revisores no se pisan. Aprobar **revalida en el servidor**. Cada paso deja evento en `cp_documento_evento` (append-only, sin el contenido de los campos).

## Salida al viaje

Crea el viaje (folio del cliente o `CP-<huella>`) o, si ya existe con ese folio, **solo le llena los huecos** (lo capturado no se pisa; lo que difiere se advierte) y reemplaza únicamente los renglones que nacieron de ese documento. Un viaje nuevo exige operador (`viaje.operador_id` NOT NULL) por nombre **exacto y único** o elegido por la persona, y que no tenga otro viaje abierto (0029); si no, el documento queda aprobado **sin viaje** y se dice qué falta. No avisa al chofer (no es despacho). Luego evalúa el borrador con `getBorradorViaje` (checklist de 37 campos + validadores SAT).

## Exportación

`/api/export/carta-porte-docs?config=estandar|<id>&formato=csv|json|xlsx[&ids=…]` (el `.xlsx` es el que se abre directo en Excel, con las mismas columnas y la misma neutralización de fórmulas; hay un botón por formato en la bandeja). El formato real del cliente de demo **se desconoce**: cada flota declara el mapeo (`cp_export_config`; columnas = campo del complemento / de mercancía / de sistema / constante; una fila por mercancía o por documento). Solo documentos aprobados. El texto que empieza con `= + - @` sale con apóstrofo (inyección de fórmulas en Excel).

## Métricas

«% sin corrección» = aprobados sin una sola corrección / aprobados (sin aprobados: `—`, no 0 %). «Tiempo ahorrado por embarque» = **12 min de captura manual (SUPUESTO declarado, `MINUTOS_CAPTURA_MANUAL_EMBARQUE`)** − tiempo de revisión **medido** (primera apertura → aprobación; > 2 h no cuenta como medición). Los aprobados sin medición no entran al ahorro y se reportan aparte.

## Retención y ARCO

Archivo y texto contienen datos personales de terceros. `retener_hasta`: recibido 180 d, aprobado 365 d, rechazado/fallido 90 d. Al vencer, el cron `/api/cron/purgar` borra el archivo (Storage) y el texto; la fila queda de constancia (`purgado_en`). Si el archivo no se pudo borrar, la fila **no** se marca purgada. Borrar la flota arrastra todo (cascada); una solicitud ARCO sobre un operador se atiende borrando el documento. Los ejemplos del perfil guardan líneas de evidencia (no el documento) y sobreviven a la purga del archivo — **decisión pendiente de Javier** si deben caducar también.

## Pruebas

Unitarias con documentos sintéticos de 7 formatos (PDF texto, PDF escaneado, foto, Excel, CSV, XML CCP, XML propio, correo), documentos defectuosos (truncado, corrupto, ejecutable, XML malformado/XXE), duplicados (misma huella por dos canales, reintento del webhook, mismo folio), inyección de instrucciones (PDF, celda de Excel, cuerpo de correo; con un modelo doble que **obedece**), aislamiento entre tenants, concurrencia (claim, revisores, aprobaciones simultáneas). SQL contra Postgres real: `supabase/tests/0420_carta_porte_multiformato.sql` (corre en `ci-postgres`).

## Bloqueos externos (no se simulan)

1. **Documentos reales de 2-3 clientes del cliente de demo** — todo se probó con fixtures sintéticos; la exactitud real (≥ 95 % por campo) no está medida. Hace falta un banco de ≥ 100 documentos reales para fijar umbrales y elegir modelo.
2. **El formato destino del cliente de demo** — se resuelve por configuración (`cp_export_config`) cuando lo entreguen; si es un sistema (SAP/TMS) y no un archivo, la integración depende de su acceso Zero Trust.
3. **Slugs de modelos** `google/gemini-3.8-flash` y `anthropic/claude-sonnet-5.5` sin verificar contra OpenRouter; Gemini 3.8 Flash duplica precio el 1-ene-2027.
4. Aplicar las migraciones 0420/0421 (y 0640-0642, 0670-0671) a la base real y correr `ci-postgres` (requiere autorización); `RESEND_EMAIL_DOMAIN` y el webhook de Resend en producción para el canal de correo; número real de WhatsApp para el canal de WhatsApp.
