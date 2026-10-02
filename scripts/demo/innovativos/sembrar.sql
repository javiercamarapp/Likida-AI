-- Orquestador del seed del DEMO «Innovativos (demo)». Se corre con sembrar.sh
-- (que pone la ancla y valida que la base sea local):  psql -v ancla='...' -f sembrar.sql
\set ON_ERROR_STOP on
\ir sql/00_guardas_y_ayudas.sql
\ir sql/01_base.sql
\ir sql/02_viajes.sql
\ir sql/03_gps.sql
\ir sql/04_peajes.sql
\ir sql/05_liquidacion.sql
\ir sql/06_cartaporte.sql
\ir sql/07_vigia_y_conductor.sql
\ir sql/08_convenios.sql
\ir sql/09_resumen.sql
