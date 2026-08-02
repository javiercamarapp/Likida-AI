# Traspaso a una sesión nueva — Likida, 2 de agosto de 2026

> Pégale esto entero a la sesión nueva. Está escrito para que no repita lo que ya
> costó horas averiguar. Todo lo de aquí se comprobó contra la base y el código;
> lo que no se comprobó lo dice.

## Qué es esto

**Likida** — liquidación de viáticos de flotas de carga por WhatsApp. El operador
manda fotos de tickets, un motor determinístico cuadra contra el anticipo y
entrega un PDF con fundamento fiscal. Repo `~/javiercamarapp/cuadra`, rama
`master`, GitHub `javiercamarapp/likida.ai`.

**Demo el 6 de agosto** con Transportes Innovativos (director de operaciones
ex-Daimler + admin/fiscal). El guion está en `GUION_DEMO.md` y es de fiar: se
corrigió el 1-ago después de que una advertencia suya resultara basada en un
diagnóstico falso.

## Estado al cerrar (1-ago, ~22:00)

- **1,570 pruebas verdes** en 163 archivos · tsc/eslint/build en 0 · árbol limpio.
- **43 migraciones**, todas aplicadas en producción.
- Auditoría 9 cerrada por otra sesión: 29 hallazgos, 29 cerrados, nota 6.5 → 7.7.
- Gasto de AI del proyecto **desde el inicio: $1.83 USD** (OpenRouter). No es el
  cuello de botella de nada.

## Lo que hay que saber antes de tocar nada

**1. Puede haber OTRA sesión de Claude editando este repo.** Pasó todo el 1-ago:
dos sesiones commiteando a `master`, una pisando los archivos de la otra, y una
corrida de pruebas que salió roja por trabajo ajeno a medias. Antes de empezar:
`git log --oneline -5` y `git status`. Si hay cambios que no reconoces, **pregunta
antes de commitear** — un `git add -A` se lleva el trabajo de la otra sesión.

**2. `git push` YA despliega.** El proyecto tiene auto-deploy conectado. Correr
`vercel deploy --prod` después del push construye **dos veces** lo mismo. No lo
hagas. Para un cambio de variable de entorno, `vercel redeploy <url>` (reconstruye
el mismo código con las variables nuevas) — `vercel deploy` y `vercel redeploy`
NO son lo mismo y confundirlos ya costó dos falsos "ya está desplegado".

**3. Los tres hosts apuntan al mismo despliegue**, pero el que importa es
`likidaai.vercel.app`: es el que tiene configurado el webhook de Meta y es
independiente del dominio. Verifica siempre con
`vercel alias ls | grep likidaai.vercel.app`.

**4. Reabrir un viaje NO es cambiar `viaje.estatus`.** El trigger de la 0036 mira
si EXISTE una liquidación, no el estatus. Cuatro veces se dijo "ya lo reabrí" con
un `update viaje set estatus='abierto'` que no permitía dar de alta ni un gasto.
Lo correcto:

```sql
delete from liquidacion l using viaje v where l.viaje_id=v.id and v.folio='VJ-...';
update viaje set estatus='abierto' where folio='VJ-...';
update wa_conversacion set estado=jsonb_set(estado,'{turns}','[]'::jsonb), viaje_id=null
 where telefono='5219993700779';
```
La fila de liquidación se regenera sola al próximo `listo` (es un upsert).

**5. PostgREST devuelve los errores POR VALOR, no lanzando.** Desestructurar solo
`data` convierte cualquier fallo en "no hay nada". Es la familia de bugs más
repetida del repo.

**6. `pruebas-manuales/*.prueba.ts` hacen llamadas de pago reales.** No se corren.

## El patrón que más dinero costó, y que sigue vivo

**El sistema decide bien y no lo dice.** Cinco veces en un día:

| dónde | qué se descartaba en silencio |
|---|---|
| foto reenviada idéntica | el dedup por hash la tiraba antes del OCR |
| foto ya registrada en otro viaje | el índice único `(tenant_id, img_hash)` la rechazaba |
| ráfaga entera de 18 fotos | tres caminos correctos, cero mensajes |
| fecha ilegible | solo salía en el PDF, cuando ya no se podía corregir |
| foto sin viaje abierto | se tiraba, mientras el XML del CFDI SÍ se guardaba |

Los cinco están arreglados. **Si encuentras un `return` silencioso en el camino
del intake, sospecha.** Y la contraparte: avisar por foto en una ráfaga produce
diez mensajes seguidos, que es el otro antipatrón — el resumen va al cerrar la
ráfaga (`intakeDelta` devuelve el contador; quien lo baja a 0 es el último).

## Construido el 1-ago (todo desplegado y verificado en producción)

- **Re-foto de fecha**: si la fecha no cuadra, se pide otra foto identificando el
  ticket (comercio, total, folio, fecha impresa), y esa foto **re-fecha** el gasto
  en vez de duplicarlo.
- **Sala de espera** (`comprobante_huerfano`, mig. 0040): una foto NUNCA se
  rechaza. Sin viaje abierto o tras liquidar, se guarda con su extracción hecha y
  se **pregunta** antes de adjuntar (adjuntar solo pondría el ticket del viaje
  anterior en éste = dinero en la liquidación equivocada).
- **Fotos archivadas** (bucket privado `comprobantes`, mig. 0039) + columna
  "Ver foto" en el panel. Antes: 22 gastos, 0 con imagen.
- **Dedup por `folioNorm`**: `05461` y `5461` son el mismo ticket. Antes se
  contaban dos veces.
- **PDF**: las observaciones se envuelven (la cita legal salía cortada, `LISR 2...`)
  y `LISR 28-V` se dice una vez con el total, no una línea por comida.

Verificado en vivo: 21 gastos, 6 copias excluidas, **comprobado $12,388.05** al
centavo contra lo calculado a mano.

## Lo que está abierto

**Bloquea el demo, y solo Javier puede:**
1. `DASHBOARD_PASSCODE` en Vercel producción tiene **5 caracteres** y la guardia
   se niega a servir el panel (`/dashboard` da 500). El valor bueno, de 28
   caracteres, ya está en `.env.local`. Hay que ponerlo en Vercel y **redesplegar**.
2. La app de Meta está en `dev_mode`: **solo el teléfono de Javier recibe**. O se
   mete a los asistentes en la allowlist, o se pasa a vivo (la política ya existe
   en `likida.ai/privacidad`; falta verificar el correo de contacto).
3. Razón social y domicilio para `likida.ai/privacidad` — hoy la página dice que
   faltan, a propósito.

**Producto, no construido:**
4. El contralor **no ve** los comprobantes en espera desde el panel.
5. No hay forma de reabrir un viaje liquidado salvo por SQL.
6. Las 5 líneas de "sigue sin factura: se pasó el plazo" se repiten casi iguales
   en el PDF, con la misma liga de portal cuatro veces. Mismo arreglo que ya se
   hizo con LISR 28-V: colapsarlas por portal.
7. La columna "Estado" del PDF sale con 13 de 15 renglones en rojo `revisar`.
   Honesto, pero proyectado parece que todo falló. Decisión de producto.

**Ensayo que falta:** un **ticket de diésel nuevo**. Es el centro del demo —los
litros del estímulo, el portal, el plazo— y es el único concepto que nunca se ha
probado con papel virgen.

## Estado de los datos del demo

`VJ-2026-0848` · **liquidado** · 21 gastos ($28,477 bruto, **$12,388.05**
comprobado) · 18 con foto · 0 en la sala de espera · 1 liquidación.
Operador `529993700779` (Javier). Tenant demo `11111111-…`.

Si necesitas volver a probar, reabre con el SQL del punto 4 de arriba.

## Cómo trabaja Javier

- Quiere que **apliques las migraciones tú** sin preguntar (excepto las que
  destruyen datos: ésas se enseñan primero).
- Quiere **commits y push seguidos**, no al final.
- **Verificar mirando**: un PDF no está bien porque las pruebas pasen — hay que
  renderizarlo y verlo. Una prueba escrita después del arreglo no vale hasta que
  la rompes a propósito y la ves fallar.
- Prefiere que le digas lo que está mal aunque no lo haya preguntado, y que no le
  adornes los resultados.
