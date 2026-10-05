#!/bin/bash
# Run S1 scenarios in parallel, each with its own Chrome and mock server. Usage: ./run.sh <round> "<scenario:dur:watch> ..."
set -e; cd "$(dirname "$0")"; round=$1; shift; mkdir -p results; p=${BASEPORT:-8800}
for spec in $1; do
  IFS=: read sc dur watch <<< "$spec"; p=$((p+1)); f="results/r${round}-${sc}.jsonl"; rm -f "$f"
  ( node server.mjs $p "$f" & sp=$!; sleep 1; node drive.mjs "$sc" $p "$dur" "$watch"; kill $sp ) &
done
wait
