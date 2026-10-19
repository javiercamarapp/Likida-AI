# Rollback de la salida de Carta Porte al TMS

Para qué sirve: detener o deshacer la salida al sistema del cliente **sin perder ningún documento**. Contexto y flujo: `carta-porte-salida-tms.md`.

Regla de oro: se retrocede en dos niveles. El nivel 1 (apagar) es inmediato, reversible y casi siempre basta. El nivel 2 (revertir migraciones) borra tablas nuevas y solo se hace si el nivel 1 no alcanza, con copia de seguridad previa.

## Nivel 1: apagar la salida (sin tocar la base)

1. **Poner el modo en descarga.** Pantalla `/dashboard/agentes/carta-porte/configuracion`, «Modo de salida: descarga». Desde ese momento el sistema no consulta ni sube nada al TMS; cada envío queda «listo».
2. **Apagar el interruptor `agente:carta_porte_salida_tms`** desde el panel de interruptores de administración. Apagado o ilegible, la pasada de envíos se salta (falla cerrado) y la extracción de la bandeja sigue normal.
   - Aviso: el panel solo puede ESCRIBIR ese interruptor en un entorno donde ya esté aplicada `0842_interruptor_carta_porte_salida_tms.sql` (amplía `interruptor_id_dominio`). Si no está aplicada, el paso 1 (modo descarga) es la palanca real. Verifica antes de contar con este paso (ver verificación abajo).
3. **Efecto sobre los documentos:** los envíos quedan donde estaban. Los «listos» se bajan con **Descargar plantilla del TMS** y se suben a mano; después, **Marcar como subido a mano**. Los que esperaban requerimiento se quedan esperando, sin avisos nuevos. Ningún documento aprobado se pierde ni se reenvía por duplicado (cada envío tiene llave de idempotencia).
4. **Si hay un envío «enviándose» trabado:** espera a que venza su reserva (2 minutos); después de eso se puede marcar como subido a mano.

Reactivar: modo `api` y encender el interruptor. Los envíos «listos» salen en la siguiente pasada.

## Nivel 2: revertir las migraciones 0790 a 0793

Cuándo: solo si hay que retirar por completo el módulo (por ejemplo, un defecto en las tablas). Antes: nivel 1 aplicado, copia de seguridad de la base hecha, y nadie capturando en la bandeja. **Este documento no ejecuta nada**: son los pasos para quien tenga la autorización de tocar la base.

Solo se borran tablas **nuevas**. Las columnas y restricciones que las migraciones añadieron a tablas existentes se **pueden dejar** (son inertes) y es más seguro dejarlas.

Orden inverso al de creación:

```sql
-- 0793: catálogos SAT (tabla global)
drop table if exists public.cp_sat_catalogo;

-- 0792: catálogo del cliente (productos, partes y número interno)
drop table if exists public.cp_catalogo_parte;
drop table if exists public.cp_catalogo_producto;
drop table if exists public.cp_cliente_numero;

-- 0791: no crea tablas. Añadió la causa de rechazo y el formato 'json'. Se deja.

-- 0790: funciones, configuración y envíos
drop function if exists public.cp_envio_liberar_alerta(uuid, uuid);
drop function if exists public.cp_envio_marcar_alerta(uuid, uuid);
drop function if exists public.cp_envio_reclamar(int, int);
drop table if exists public.cp_salida_config;
drop table if exists public.cp_envio_tms;
```

Lo que se deja a propósito:

- `cp_documento.revisor_asignado` (0790) y `cp_documento.rechazo_causa` (0791): columnas con valor nulo por omisión.
- La restricción de formatos con `json` (0791): quitar `json` fallaría si ya hay documentos con ese formato.
- La restricción de tipos de evento de `cp_documento_evento` (0790): ya puede haber eventos `envio_*` o `revisor_asignado`. Reducir la lista haría fallar la restricción. No se toca.

Después del nivel 2 el código desplegado que consulta esas tablas fallaría: **antes** de borrar, desplegar una versión que no las use, o mantener apagados el interruptor y el modo descarga y dejar las tablas (que es la opción recomendada).

## Qué NO hace el rollback

- No toca el requerimiento ni nada del TMS: lo que ya se subió allá se queda.
- No borra documentos, hallazgos ni la bitácora.
- No cambia los viajes ya creados.

## Checklist de verificación posterior

Marca cada línea con la evidencia (captura o consulta), no de memoria.

Tras apagar (nivel 1):

- [ ] La configuración muestra «descarga» y guarda al recargar.
- [ ] El interruptor `agente:carta_porte_salida_tms` figura apagado en el panel (requiere `0842_interruptor_carta_porte_salida_tms.sql` aplicada), o se anotó que esa migración aún no está aplicada en este entorno y el modo descarga es la palanca.
- [ ] El cron de Carta Porte responde: la extracción corre y la salida dice «saltada» o no sube nada (revisar el registro `cron.carta_porte_docs.salida_saltada`).
- [ ] Un documento aprobado de prueba queda «Listo para enviar» y se descarga la plantilla.
- [ ] «Marcar como subido a mano» cambia el estado y el botón desaparece.
- [ ] Los filtros de la bandeja (En curso, Subidos a mano) cuentan lo mismo que antes.
- [ ] No salieron avisos nuevos a la oficina después del apagado.

Tras revertir (nivel 2):

- [ ] Las tablas de arriba ya no existen (`select to_regclass('public.cp_envio_tms')` devuelve nulo) y las demás tablas de Carta Porte siguen intactas.
- [ ] La bandeja de documentos abre y se pueden revisar y aprobar documentos.
- [ ] La salud de producción (`/api/health`) reporta la base esperada; si indica que el código va por delante de la base, no desplegar.
- [ ] El cron no registra errores de tablas faltantes.

Reactivación:

- [ ] Modo `api` solo con conector y credenciales válidas.
- [ ] Un envío de prueba llega a «Enviado» o a «Esperando requerimiento» con su fecha de próxima revisión.
