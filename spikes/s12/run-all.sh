#!/bin/sh
# Runs every S12 scenario twice (s1 also with the awaited order). Usage: sh run-all.sh [port] [scenario...]
cd "$(dirname "$0")"
PORT=${1:-8912}
shift 2>/dev/null
SCENARIOS=${*:-"s1 s2 s3 s4 s5 s7 s8"}
run() { # scenario order run
  f="results/$1-$2-$3.jsonl"; rm -f "$f"
  node server.mjs "$PORT" "$f" & S=$!
  sleep 0.5; node drive.mjs "$PORT" "$1" "$2"; sleep 0.5; kill $S
}
for r in 1 2; do
  for s in $SCENARIOS; do run "$s" unawaited "$r"; done
  case " $SCENARIOS " in *" s1 "*) run s1 awaited "$r" ;; esac
done
