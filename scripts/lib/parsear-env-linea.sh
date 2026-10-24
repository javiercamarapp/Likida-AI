#!/usr/bin/env bash
# A37-L-10: parseo de una línea de .env.local con semántica de dotenv.
#   · valor entre comillas ("..." o '...'): se toma hasta la comilla de cierre;
#     un '#' dentro de las comillas es parte del secreto;
#   · valor sin comillas: el comentario inline solo empieza en ' #' (espacio
#     antes del '#'), nunca en un '#' pegado al valor; se quitan espacios finales;
#   · se tolera el prefijo 'export '.
# Uso: parsear_env_linea "$line"  → imprime "NOMBRE<TAB>VALOR" (nada si no es asignación).
parsear_env_linea() {
  local line="$1" name val rest
  case "$line" in ''|\#*) return 0 ;; esac
  line="${line#"${line%%[![:space:]]*}"}"
  line="${line#export }"
  case "$line" in *=*) ;; *) return 0 ;; esac
  name="${line%%=*}"
  name="${name%"${name##*[![:space:]]}"}"
  rest="${line#*=}"
  rest="${rest#"${rest%%[![:space:]]*}"}"
  case "$rest" in
    \"*)
      rest="${rest#\"}"
      val="${rest%%\"*}" ;;
    \'*)
      rest="${rest#\'}"
      val="${rest%%\'*}" ;;
    *)
      val="$rest"
      case "$val" in
        *' #'*) val="${val%% #*}" ;;
        *$'\t#'*) val="${val%%$'\t'#*}" ;;
      esac
      val="${val%"${val##*[![:space:]]}"}" ;;
  esac
  printf '%s\t%s\n' "$name" "$val"
}
