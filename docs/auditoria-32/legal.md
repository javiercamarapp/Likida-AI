# Cumplimiento legal — auditoría 32

**Nota: 3/10** (antes 3). Razón del movimiento: **ninguna de las tres razones
aplica.**

Lo contable, primero, porque es lo que sostiene esa frase:

```
git diff --stat 8b01aec..HEAD      →  scripts/mejora-diaria/rutina.sh | 1 -
git log 8b01aec..HEAD -- src/ supabase/ normas/  →  (vacío)
```

Cero líneas de `src/`, cero de `supabase/`, cero fichas `normas/*.yaml`. El árbol
que califico hoy es, en la superficie de este rubro, byte por byte el que la 31
calificó. *Se atacó y subió* no aplica porque nadie atacó nada. *Deuda que cobró
factura* no aplica porque no hubo producción que la cobrara (base en cero, cero
clientes). Y *mirada más profunda* —la única que quedaba— exige decir que la nota
anterior estaba inflada, y **no lo estaba**: el ancla del rubro dice «3 o menos si
hay transferencia de datos personales sin cobertura», hay dos abiertas
(LEG-A1, LEG-A5) y las reverifiqué línea por línea hoy. 3 era y sigue siendo lo
que el texto de la regla manda.

Encontré **un hallazgo nuevo [ALTO]** que la 31 no vio y que además contradice
parcialmente una de sus afirmaciones de «esto está bien». No mueve la nota hacia
abajo porque no introduce una transferencia nueva sin cobertura —es un derecho
anunciado que no se puede honrar—, y la banda de abajo del ancla no está descrita.
Lo que sí hace es que 3 quede **mejor sostenido**, no peor.

**Números contables de esta ronda:**

- **16 / 16** hallazgos abiertos de la 31 reconfirmados con `archivo:línea` de
  hoy. Cero cerrados. Cero mal reportados.
- **1** hallazgo nuevo: LEG-32-A1 [ALTO].
- **5** finalidades que el aviso declara oponibles (`privacidad.ts:787`, `:809`,
  `:810`, `:817`, `:824`, `:833`); **1** mecanismo que las materializa
  (`operador.oposicion_automatizada`, mig. 0100); **4** sin camino de código.
- **1** escritor de `oposicion_automatizada` en todo `src/` (`processor.ts:354`);
  **2** lectores reales (`cuadre/desde_db.ts:95` y —esto la 31 no lo vio—
  `0348:193`, dentro de `stats_operador_tenant`).
- **0** apariciones de `oposicion_automatizada` en `0325` (jornada), en
  `sincronizar_eventos.ts`, en `sincronizar_gps.ts` y en `posiciones.ts`.
- Suite del rubro: `npx vitest run privacidad arco` → **21 archivos / 169
  pruebas, 169 en verde, 2.59 s** — idéntico a la 31, como corresponde a un
  árbol idéntico. Ninguna prueba vigila el hallazgo nuevo.

**Riesgo mayor del rubro, hoy:** el aviso del operador es un documento
inusualmente bueno —fundado en la ley de 2025, no en la abrogada, y con los
límites dichos donde otros callarían— y precisamente por eso **promete más
derechos y más borrados de los que el esquema puede ejecutar**. Cada ronda que
mejora el texto sin mover la maquinaria ensancha la distancia entre lo firmado y
lo ejecutable, y esa distancia es exactamente la prueba que un titular necesita.

---

## Estado de los 16 abiertos

| ID | Estado | `archivo:línea` de hoy |
|---|---|---|
| **LEG-31-C1** [CRÍTICO] | **sigue abierto** | `privacidad.ts:766` (la promesa, literal) · `0165_storage_sin_delete_directo.sql:134-135` (candado 1: el objeto solo entra a `condenados` si `es_uuid(j.viaje_txt)`, y el segmento aquí es la cadena literal `sin-viaje`) · `:137-139` (candado 2: `and not exists (select 1 from public.comprobante_huerfano h where h.ruta_imagen = j.name)`) · `0178_fiscal_retencion_arco_y_perfiles_erp.sql:29-52`, en concreto `:42-44` y `:48` (candado 3: `fiscal_cff_30` por existir la fila, sin mirar `resolucion`) · `storage_borrado.ts:52` y `:115` (`.eq('clase_retencion','operativa')`) · `0335:314-345` (18 funciones, `comprobante_huerfano` en ninguna) · `0356` (0 coincidencias) |
| **LEG-C1** [CRÍTICO] | **sigue abierto** | `asistencia_coordinacion.ts:122` (`` `Ubicación: https://maps.google.com/?q=${d.lat},${d.lng}` ``) · `:337` (`mensaje_preparado: mensaje`) · `0213_coordinacion_proveedor.sql:69` · `privacidad.ts:688` («se conservan **90 días**») · `grep -rn coordinacion_proveedor supabase/migrations/*.sql` → **10 coincidencias, las 10 en 0213**; cero en 0289, cero en 0335, cero en 0356 |
| **LEG-31-A1** [ALTO] | **sigue abierto** | `privacidad.ts:371-378` (FNV-1a 32 bits, base 36) · `:401-416` (`versionAvisoVigente`, el texto se regenera, no se persiste) · `0033_aviso_reserva_aparte.sql:104-108` (`update operador set …`, no `insert`) · `aviso/[tenant]/page.tsx:38` |
| **LEG-A1** [ALTO, REINCIDENTE] | **sigue abierto** | `privacidad.ts:912` («la que compartiste por el chat») vs. `asistencia_camara.ts:209-210` (`lat: e.lat, lng: e.lng` del evento de cámara) · `asistencia_coordinacion.ts:316-317` (`lat: inc.lat` sin distinguir origen) · las dos categorías separadas en `privacidad.ts:687`/`:690` |
| **LEG-A5** [ALTO, REINCIDENTE] | **sigue abierto** | `asistencia_coordinacion.ts:125` (`` `Contacto directo del jefe de tráfico: ${d.telefonoJefe}.` ``) · `:305` (resuelto por rol) vs. `app/privacidad/page.tsx:57` (Likida responsable), `:124`/`:130` (solo encargadas), `:132` («te lo pediríamos antes») |
| **LEG-A2** [ALTO, REINCIDENTE] | **sigue abierto** | `dashboard/arco/page.tsx:262` («**su contacto de emergencia** y su registro de jornada laboral» — antes del clic) vs. `:33` («se eliminaron … **y el contacto de emergencia**» — después) · manda `0356:76-78` (`delete from contacto_emergencia`) · el arnés sigue siendo substring: `cancelacion_alcance.test.tsx:45` |
| **LEG-A3** [ALTO, 3ª ronda] | **sigue abierto** | `0356:121` (**cuatro** categorías) vs. `repo.ts:1828` (**siete**) vs. `dashboard/arco/page.tsx:33` (siete) |
| **LEG-A4** [ALTO, 4ª ronda] | **sigue abierto** | `processor.ts:1600` (`porOperador?.operadorId ?? null`, con `userId` disponible en `contactos.ts:96` y descartado) · `0356:39-41` (rebote «solicitud sin operador») · `app/privacidad/page.tsx:150` y `:170` (la promesa a esa misma población) |
| **LEG-A6** [ALTO, 3ª ronda] | **sigue abierto** | `processor.ts:342` (`if (datos)`) · `:352-356` (el único `update`) · `:369` (el `warn`, **dentro** del mismo `if`) · `:377-380` (la respuesta genérica) · `0178:152-162` (`ejecutar_arco_oposicion` tampoco escribe la columna) |
| **LEG-A7** [ALTO, REINCIDENTE] | **sigue abierto** | `0356:85-90` (`update incidencia set descripcion=…, operador_id=null` — **sin tocar `viaje_id` ni `hay_lesionados`**) · `0047_operacion_encargado.sql:100` · `0198_asistencia_siniestros.sql:46` · `0356:121` (`viaje.operador_id` conservado a propósito) |
| **LEG-31-M1** [MEDIO] | **sigue abierto** | `privacidad.ts:664` (catálogo fr. II acotado a gastos) vs. `processor.ts:2348`/`:2361`/`:2367` · `pod_wa.ts:82-91` (upsert con `operador_id`) · `:105` («quedó guardada como evidencia de entrega») · `pod` ausente de `0335:314-345` y de `0356` |
| **LEG-M1** [MEDIO, 3ª ronda] | **sigue abierto** | `aviso/[tenant]/page.tsx:38` (`VIGENTE_DESDE = '2026-09-01'`) · `:109` vs. `git log -1 --date=short -- src/lib/likida/privacidad.ts` → **`8fc2fa7 2026-09-08`** |
| **LEG-M3** [MEDIO, 4ª ronda] | **sigue abierto** | `privacidad.ts:958` (`return 'acceso'` por omisión) · `ls src/app/api/export/` → **siete rutas, todas de flota**: `bitacora-peaje`, `carta-porte-xml`, `facturas-proveedor`, `jornada`, `liquidaciones`, `pdf`, `poliza` |
| **LEG-M4** [MEDIO, 3ª ronda] | **sigue abierto** | `privacidad.ts:1100` («se borran tus datos de persona») · `correo/respuesta_campana.ts:110-111` («No toca … `comercial_evento` (la anonimiza `purgar_comercial_evento` **por edad, no por baja**)») · `admin/calcom_webhook.ts:190` (`p_payload: evt.payload ?? {}`) · `0245:139-148` |
| **LEG-B1** [BAJO, 3ª ronda] | **sigue abierto** | `privacidad.ts:295`, `:322`, `:734`, `:746` («art. 3 fr. …» de la ley **abrogada**) · `meta/client.ts:744` («LFPDPPP art. 21»). Vigentes: art. 2 (definiciones) y art. 20 (confidencialidad). *(`privacidad.ts:861` cita «Reglamento art. 21» y ése sí es correcto: es el Reglamento, no la ley — no cuenta.)* |

Ninguno **mal reportado**. Las únicas diferencias con la 31 son corrimientos de
±3 líneas en dos citas de `0178` y de `app/privacidad/page.tsx`, corregidos
arriba contra el archivo de hoy.

---

## Hallazgos

### [ALTO] LEG-32-A1 — El aviso ofrece la oposición sobre CINCO finalidades una por una; el único mecanismo que existe materializa UNA, y la RPC de la flota deja constancia escrita de que «la oposición está vigente» mientras el cron de jornada, el mapa de posiciones y la revisión de conducta siguen corriendo ligados a esa persona

`src/lib/likida/privacidad.ts:787` · `:809` · `:810` · `:817` · `:824` · `:827` ·
`:833-839` ·
`src/lib/likida/processor.ts:351-357` (el único escritor, `:354`) · `:362` (el acuse) ·
`supabase/migrations/0100_oposicion_decision_automatizada.sql:20-24` ·
`src/lib/likida/cuadre/desde_db.ts:95` · `src/lib/likida/cuadre/engine.ts:616` ·
`supabase/migrations/0325_capacidad_wa_jornada_timezone.sql:853` ·
`src/lib/likida/conectores/sincronizar_eventos.ts:200-207` ·
`src/lib/likida/jornada/derivar.ts:225` · `src/app/api/cron/jornada/route.ts:78` ·
`src/app/api/export/jornada/route.ts:81` · `:101` ·
`supabase/migrations/0178_fiscal_retencion_arco_y_perfiles_erp.sql:157-161` (en concreto `:160`) ·
`src/lib/likida/repo.ts:1749-1766`

**Base normativa.** `normas/lfpdppp-15-16.yaml`, `estado_verificacion:
verificado_fuente_primaria`, última reforma DOF 14-nov-2025 — art. 15 fr. IV,
literal: *«Las **opciones y medios** que el responsable **ofrezca** a las personas
titulares **para limitar el uso o divulgación** de los datos»*. Y art. 14, del
mismo texto: el aviso informa *«a fin de que pueda tomar decisiones
informadas»*. Una opción ofrecida y sin medio detrás no es una opción: es
información que induce a error sobre el tratamiento. `normas/lfpdppp-26-II.yaml`
(también `verificado_fuente_primaria`) aporta el otro lado: la fr. II del art. 26
es **un derecho de oposición del titular**, no una obligación proactiva — la
ficha lo corrige expresamente contra la conclusión de la ola 1 —, de modo que lo
que decide aquí no es la ley sino **lo que el aviso ofreció**.

**Lo que el aviso ofrece, contado.** La sección «Para qué se usan» (art. 15
fr. III) abre en `privacidad.ts:787` con «**Finalidades que NO son necesarias, y
a las que puedes oponerte sin que eso afecte tu liquidación:**» y enumera, cada
una con su oposición dicha aparte:

1. `:788` — revisar si un comprobante viene repetido o alterado (la del art. 26
   fr. II, desarrollada en la sección propia de `:833-839`).
2. `:793` — anotar la hora de los avisos del viaje para medir tiempos.
3. `:809` / `:810` — «Puedes oponerte a que esas posiciones se usen **ligadas a
   tu persona**».
4. `:817` — «Derivar tu **registro de jornada** … Puedes oponerte a que se
   derive **ligado a tu persona**».
5. `:824` / `:827` — «Fuera de un accidente, tu empresa también puede usar esos
   eventos para revisar cómo conduces; **puedes oponerte** a que ese uso quede
   ligado a tu persona».

**Lo que existe.** Una sola columna, `operador.oposicion_automatizada`
(`0100:28`). `grep -rn "oposicion_automatizada" src/` devuelve **un escritor**
(`processor.ts:354`) y, como consumidores reales, `cuadre/desde_db.ts:95 →
engine.ts:616` (la liquidación sale a revisión humana) y `0348:193` (la excluye
de `stats_operador_tenant`). El propio comentario de la 0100 lo acota sin
ambigüedad (`:20-24`): *«Quién la lee: `cuadre/desde_db.ts` la pasa al motor…»*.
Nada más la lee.

**Escenario (con valores).** Juan Pérez, `op-1`, flota `t-9`, con
`aviso_privacidad_en = '2026-03-01'` y `tenant.razon_social` capturada (o sea:
el camino feliz, sin LEG-A6 de por medio).

1. **3-oct-2026, 19:40.** Juan escribe por WhatsApp: *«no quiero que usen mis
   posiciones para sacar mi jornada, me opongo»*.
2. `tipoDeSolicitudArco` (`privacidad.ts:952-959`) normaliza y evalúa: casa
   `/\bme\s+(?:\w+\s+){0,3}opon(?:go|er|ga)\b/` (`:448`) **y**
   `/\bno\s+(?:quiero|autorizo|acepto)\s+que\s+(?:me\s+)?(?:revisen|analicen|usen|traten)\b/`
   (`:453`) → **`'oposicion'`**. Se inserta la `solicitud_arco`.
3. `processor.ts:351-357`: `tipo === 'oposicion'` y `operadorId = 'op-1'` →
   `update operador set oposicion_automatizada = '2026-10-03T19:40:00Z'`.
4. `processor.ts:362` le contesta: **«Además, desde ahora tus liquidaciones las
   revisa una persona antes de cerrarse. Queda registrado. 👍»** — que es
   literalmente cierto y responde a **otra** finalidad que la que él nombró.
5. **4-oct-2026, 02:00.** Corre `/api/cron/jornada` (`route.ts:78` →
   `derivarJornadas`). La lista de trabajo la arma
   `reclamar_jornadas_por_derivar`, y su **única compuerta de privacidad** es
   `0325:853`: `(o.aviso_privacidad_en is not null) as aviso_previo`. En toda la
   migración 0325, `grep -n "oposicion" → 0 coincidencias`. La jornada del 3-oct
   de `op-1` **se deriva**: hora de arranque, horas al volante, descansos, a
   partir de las mismas posiciones a las que él se opuso.
6. **6-oct-2026.** El contralor baja `/api/export/jornada`. `route.ts:81` resuelve
   `nombresDeOperadores` y `:101` escribe `operadorNombre: 'Juan Pérez'` junto a
   sus horas. `/dashboard/jornada:139` pinta lo mismo en pantalla.
7. **En paralelo**, `sincronizar_eventos.ts:200-207` sigue trayendo los eventos
   de cámara de su unidad: lee `aviso_privacidad_en` y **nada más** — la
   revisión de conducta de `:824` tampoco se apagó.
8. **20-oct-2026.** La flota abre `/dashboard/arco` y aprieta el botón de
   oposición. `ejecutarOposicionArco` (`repo.ts:1772`) llama
   `ejecutar_arco_oposicion`, que escribe en `solicitud_arco.evidencia`
   (`0178:160`) **`'oposicion_automatizada_vigente', true`**. Esa es la
   constancia que la responsable exhibiría bajo el art. 31.

**Intenté refutarlo y no se cae.**
(a) *¿Hay un interruptor manual por finalidad en el panel?* No.
`grep -rn "excluir|excluido|opt_out|jornada_excluid" src/lib/likida/jornada/
src/lib/likida/conectores/` devuelve **cero** fuera de pruebas. La flota no tiene
dónde apagarlo aunque quiera cumplir.
(b) *¿La jornada está dispensada por ser obligación legal?* Es el argumento más
fuerte en contra, y **solo cubre una de las cinco**: el art. 26, último párrafo
—en la ficha, literal— dice que *«no procederá el ejercicio del derecho de
oposición … cuando el tratamiento sea necesario para el cumplimiento de una
obligación legal impuesta al responsable»*, y la LFT art. 132 fr. XXXIV
(`normas/lft-132-XXXIV-jornada.yaml`) impone llevar el registro. Pero (i) el
propio aviso metió la jornada entre las **NO necesarias** y ofreció la oposición
en `:817`, y una opción ofrecida obliga por el art. 15 fr. IV aunque la ley no la
exigiera; y (ii) la dispensa **no alcanza** al seguimiento y medición de tiempos
de `:809-810` ni a la revisión de conducta de `:824`, que no cumplen ninguna
obligación legal y siguen igual de desatendidas.
(c) *¿Lo cubre LEG-A6?* No. LEG-A6 es «el interruptor no se puede **encender**
cuando falta la razón social». Éste es el caso contrario y peor: el interruptor
**se encendió**, hay acuse por WhatsApp y constancia en `evidencia`, y aun así
cuatro de las cinco finalidades ofrecidas siguen corriendo. Los dos pueden
arreglarse por separado.
(d) *¿La 31 ya lo había dicho?* No, y aquí es donde corrige. Su sección «Lo que
revisé y está bien» afirma: *«La oposición del art. 26 fr. II, cuando llega a
encenderse, sí muerde. Traza completa verificada de punta a punta: un solo
escritor, un solo lector (`desde_db.ts:95`), un solo consumidor
(`engine.ts:616`)»*. Eso es correcto **para la fr. II** y es exactamente lo que
lo oculta: verificó la traza de la finalidad que sí funciona y la declaró
completa, sin cotejarla contra las otras cuatro que el mismo aviso ofrece
doscientas líneas más arriba. Con el mismo comando amplío el dato: hay **dos**
lectores, no uno — `0348:193` también filtra —, lo que confirma que el equipo sí
extiende el candado a mano, tabla por tabla, y que se detuvo en analytics.
(e) *¿Es solo texto?* No: el paso 8 produce un **documento** de la responsable
que afirma que la oposición está vigente. La diferencia entre «no lo honramos» y
«certificamos por escrito que lo honramos y no lo honramos» es la que decide una
sanción.

**Consecuencia.** El titular ejerce el derecho por el canal que el aviso le
indica, recibe acuse, y su registro nominal de jornada —derivado de las
posiciones a las que se opuso— sale al día siguiente en un CSV con su nombre y
sus horas, junto con los eventos de «cómo conduces». Ni él ni la flota tienen
forma de enterarse: no hay log de la oposición no honrada (el único `warn`,
`processor.ts:369`, es para la rama sin operador) y la constancia dice lo
contrario. Para la flota —la responsable— es el peor material posible en una
verificación: prueba documental, generada por su propio sistema, de que conocía
el ejercicio del derecho y siguió tratando. Y el que se lleva el daño concreto es
el chofer, porque la jornada y la conducta son justamente lo que se usa para
sancionarlo.

**Causa raíz probable.** La oposición se modeló como un **booleano de producto**
(«esta liquidación necesita revisión humana»), no como un **alcance**: una sola
columna sin granularidad de finalidad, mientras el aviso —que se siguió
enriqueciendo finalidad por finalidad— multiplicó por cinco las oposiciones
ofrecidas sobre ese mismo bit.

---

## Lo que revisé y está bien

- **La revocación de credenciales de conector destruye el secreto, y además
  mata la sesión.** `conectores/credenciales.ts:460-487`: `desactivarCredencial`
  no solo apaga `activo`, **pisa `valores_cifrados` con `revocada:<fecha>`**
  (`:466`) —marcador que el CHECK `conector_credencial_no_en_claro` acepta y que
  `descifrar` jamás abrirá—, ancla el `update` a `tenant_id` **y comprueba las
  filas devueltas** (`:472-475`: cero filas no es un error en Postgres y sin
  mirarlo la pantalla diría «desactivada» sobre una credencial viva), y en
  `:486-487` invalida la sesión de portal ya iniciada, que es el agujero real
  —la cookie sobrevive a la contraseña—. Está razonado por escrito contra el
  art. 11 en `:440-458`. Este es el punto de mi rubro que dice «credenciales de
  portales guardadas de forma que no se puedan revocar»: **está cerrado
  estructuralmente**, y levanto el pendiente que la 31 arrastraba.
- **`portal_credencial` sigue sin escritor y sin lector.** `grep -rn
  "portal_credencial" src/` → **cero**; solo existe en `0063:68-101`, con RLS
  activo y el CHECK `secreto_ref_no_parece_secreto` (`:99-101`) que impide
  guardar ahí algo que parezca un secreto. Una tabla vacía con un candado que
  prohíbe llenarla mal no es un hallazgo.
- **`stats_operador_tenant` sí honra la oposición, y con la razón escrita.**
  `0348:193` (`where … o.oposicion_automatizada is null`) y
  `analytics.ts:350-357`, que explica por qué: *«el conteo de sus diferencias es
  justo la clase de señal automatizada sobre su persona a la que se opuso»*. Es
  la extensión correcta del candado y el precedente exacto que falta en los
  cuatro caminos de LEG-32-A1. La 31 no lo contó entre los lectores; corregido
  arriba, en la dirección buena.
- **`getOperadoresDetalle` calcula un `pctComprobado` por persona y NADIE lo
  pinta.** Lo perseguí como posible perfilamiento y se cae:
  `dashboard/operadores/page.tsx:26-31` deja el dinero por chofer **en el
  servidor** a propósito («fue exactamente la fuga del 4-ago-2026») y desde la
  0298 ni siquiera usa esa función; el único consumidor vivo,
  `inicio-operacion.tsx:105`, la usa **solo** para las alertas de vigencia de
  licencia (`:291-309`). No lo reporto: la evaluación no llega a ninguna
  pantalla.
- **La compuerta de aviso previo existe y corre en DOS caminos independientes.**
  `0325:853` para la derivación de jornada (con su contador propio,
  `derivar.ts:93` y `:281`, `sinAvisoPrevio`) y `sincronizar_eventos.ts:200-207`
  para los eventos de cámara. «No se trata antes de avisar» no es una promesa
  suelta: está implementada dos veces, en SQL y en TS, por equipos distintos del
  mismo código.
- **El catálogo de finalidades de la fr. III es de los mejores textos del repo.**
  `privacidad.ts:777-832`: separa necesarias de no necesarias donde la ley lo
  pide, y dice el límite incómodo en vez de esconderlo — `:810`, sobre el GPS:
  *«el rastreo del camión es un contrato de tu empresa con su proveedor y no se
  apaga desde aquí, y decírtelo así es más honesto que prometer lo contrario»*.
  El defecto de LEG-32-A1 está **debajo** de ese texto, no en él.
- **Las cuatro fichas LFPDPPP están en la ley vigente, verificadas contra fuente
  primaria.** `lfpdppp-15-16`, `lfpdppp-2-XII-XX`, `lfpdppp-26-II` y
  `lfpdppp-59`: las cuatro con `estado_verificacion:
  verificado_fuente_primaria`, `fecha_vigencia_desde: 2025-03-21` y
  `ultima_reforma: 2025-11-14`. La ficha de la 26-II incluso **corrige** una
  conclusión anterior del propio proyecto («no dice eso: es un derecho de
  OPOSICIÓN, no una obligación proactiva») para no venderle a la flota un
  requisito que la ley no le impone. El razonamiento con la ley abrogada
  sobrevive **solo** en comentarios (LEG-B1), nunca en las fichas ni en lo que
  el titular lee.
- **El anexo de subencargados existe y dice la verdad.**
  `docs/conocimiento/52-anexo-subencargados.md`, 373 líneas, con la cadena real
  de ocho eslabones y sus subeslabones (2a Google, 2b Anthropic, 2c OpenAI bajo
  OpenRouter; 6a AWS SES bajo Resend), cada renglón con el archivo donde se
  verifica. Corrige al propio `11-datos-personales.md` §7 y apoya la definición
  de «encargada» en `lfpdppp-2-XII-XX.yaml` señalando que la figura de
  «remisión» del Reglamento de 2011 **no aparece una sola vez** en la ley de
  2025. Con esto, la cláusula de `app/privacidad/page.tsx:131` («el detalle de
  esos subencargados está en la documentación del producto») **es verdad**, no
  una remisión a la nada. Cierro el pendiente que la 31 dejó abierto.
- **Suite del rubro en verde y sin movimiento.** `npx vitest run privacidad arco`
  → 21 archivos, 169 pruebas, 169 pasando, 2.59 s. Mismos números que la 31, que
  es lo que debe pasar con el mismo árbol.

## Lo que NO alcancé a revisar

- **La retención del lado del proveedor** (Meta, OpenRouter y su cadena de tres,
  Facturapi/PAC, Stripe, Cal.com, Resend/AWS SES, Samsara). **Sexto pendiente
  consecutivo.** El anexo 52 dice qué recibe cada uno; desde el repo se lee lo
  que se **pide** en cada llamada, no lo que el proveedor cumple, y sin red
  saliente no hay forma de cotejar contra sus términos. Es el hueco estructural
  del rubro y no se cierra leyendo código.
- **La cláusula del art. 35 con casilla de aceptar/rechazar.** Sigue sin
  mecanismo en `privacidad.ts` ni en `/privacidad`, y sigo sin poder resolver si
  las transferencias vivas caen todas en las excepciones del art. 36 (que
  dispensan el consentimiento pero quizá no la cláusula). **No lo reporto como
  hallazgo**: necesita criterio legal humano, no lectura de código. Segunda ronda
  anotado; si la respuesta es que sí hace falta, es un hallazgo de estructura.
- **La retención de los logs de plataforma** (`processor.ts:1834-1837` escribe la
  transcripción íntegra de la nota de voz en el log). **Séptimo pendiente
  consecutivo.** Sin panel de Vercel no se mide.
- **El resto del embudo comercial más allá de LEG-M4** (`comercial_evento`,
  `prospecto_persona`, `campana`, `/aviso/prospectos`), donde Likida es
  responsable por derecho propio y no encargada. Abrí solo lo que LEG-M4 toca.
- **`invitacion`**: sin escritor según el MAPA; no verifiqué si algún camino
  nuevo la llena. `portal_credencial` sí lo verifiqué (arriba).
- **Las tres finalidades oponibles restantes de LEG-32-A1 no las recorrí hasta el
  render.** Confirmé con `grep` que ni `0325`, ni `sincronizar_eventos.ts`, ni
  `sincronizar_gps.ts`, ni `posiciones.ts` consultan `oposicion_automatizada`, y
  seguí **solo la de jornada** hasta la pantalla y el CSV. Las de hitos,
  seguimiento por posiciones y revisión de conducta las doy por no honradas por
  ausencia del identificador, no por traza completa: el escenario con valores es
  el de jornada.
- **La base entera está en cero** (0 viajes, 0 clientes). Ningún escenario se
  confirmó contra filas reales: todos están construidos leyendo código,
  migraciones y fichas de `normas/`, y **cada línea citada la abrí y la leí**.
  Las afirmaciones sobre SQL que solo corre contra Postgres —los tres candados de
  LEG-31-C1, la compuerta `aviso_previo` de `0325:853`, el `delete from
  contacto_emergencia`— las tomo del texto de las migraciones, no de una corrida.
