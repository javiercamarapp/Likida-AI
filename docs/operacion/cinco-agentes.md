# Operación del perfil de cinco agentes (índice)

Punto de entrada para quien opera una flota con el perfil `cinco_agentes`: qué documento leer para cada tarea y cómo se
enciende y se apaga el perfil en una flota. Este índice no repite el contenido de los documentos: los enlaza. No lleva
nombres de personas ni de empresas; se habla siempre de «la flota».

Fase vigente: **A1 liquidación, A2 peajes y A3 carta porte activos; A4 vigía y A5 conductor «Próximamente»** (visibles en el
menú, sin datos ni acciones). El estado por agente (crons, migraciones) está en [indice-agentes.md](indice-agentes.md).

Solo se enlazan documentos que existen en esta rama. Los de la conexión con el sistema de transporte, los insights y la
salida de carta porte se añadirán a esta tabla cuando se integren sus frentes.

## Qué leer, según la tarea

| Quiero… | Documento |
|---|---|
| Entender qué recorta el perfil, qué queda en stand-by y cómo falla (cerrado) | [perfil-cinco-agentes.md](perfil-cinco-agentes.md) |
| Aplicar o revertir el perfil en una flota | [perfil-cinco-agentes.md](perfil-cinco-agentes.md), sección «Aplicar y revertir», y los scripts `scripts/perfil/aplicar-cinco-agentes.sh` y `scripts/perfil/revertir-cinco-agentes.sh` |
| Operar o revertir peajes | [conciliacion-peajes.md](conciliacion-peajes.md), [peajes-revision-cobros.md](peajes-revision-cobros.md) y [peajes-rollback.md](peajes-rollback.md) |
| Operar liquidación | [liquidacion-externa.md](liquidacion-externa.md) y [liquidacion-desglose-correo.md](liquidacion-desglose-correo.md) |
| Operar carta porte | [carta-porte-multiformato.md](carta-porte-multiformato.md) |
| Preparar el vigía y el conductor para la fase 2 | [vigia-cliente.md](vigia-cliente.md), [vigia-aviso-proactivo.md](vigia-aviso-proactivo.md) y [agente-conductor.md](agente-conductor.md) |
| Plantillas de WhatsApp (catálogo generado) | [plantillas-meta.md](plantillas-meta.md) |
| Fixtures y datos de prueba (siempre sintéticos) | [fixtures-sinteticos.md](fixtures-sinteticos.md) |

## Cómo operar una flota con el perfil

Lo ejecuta quien opera la plataforma, con copia de seguridad previa y una flota a la vez. El detalle y los comandos
exactos viven en [perfil-cinco-agentes.md](perfil-cinco-agentes.md); aquí solo el orden.

1. **Migraciones primero.** Aplicar en la base de destino las migraciones que el perfil y los agentes activos necesitan
   (la tabla de perfil y las de cada agente están en [indice-agentes.md](indice-agentes.md)). El código funciona contra
   una base sin su migración y lo dice; no inventa un estado.
2. **Verificar sin escribir.** `scripts/perfil/aplicar-cinco-agentes.sh --verificar <UUID-de-la-flota>` solo lee y
   muestra qué tiene hoy la flota.
3. **Aplicar el perfil.** El mismo script sin `--verificar`: una transacción, solo esa flota, sin borrar datos.
4. **Comprobar como el cliente.** El superadmin que mira la flota con `?tenant=` ve lo mismo que el cliente: menú
   recortado, A4 y A5 con «Próximamente», APIs y crons de stand-by cerrados.
5. **Revisar los resultados** de cada agente activo: todo número con fuente, todo candidato rotulado como tal, ninguna
   cifra de ahorro sin línea base.

## Rollback

| Qué se revierte | Cómo |
|---|---|
| El perfil de una flota | `scripts/perfil/revertir-cinco-agentes.sh <UUID-de-la-flota>` (borra la fila de perfil y re-enciende solo lo que el perfil apagó); sección «Aplicar y revertir» de [perfil-cinco-agentes.md](perfil-cinco-agentes.md) |
| Peajes | [peajes-rollback.md](peajes-rollback.md) |
| El aviso proactivo del vigía | [vigia-aviso-rollback.md](vigia-aviso-rollback.md) |

Una flota sin fila de perfil se comporta exactamente como siempre: quitar la fila es el rollback completo del recorte.

## Reglas que no cambian

- Fixtures y capturas, siempre sintéticos; nada de datos reales de una flota en el repositorio.
- Lo que está en stand-by está oculto e inoperante, no borrado.
- Ningún envío real (mensajes, correos, plantillas) sin decisión explícita del responsable de la plataforma.
