#!/bin/bash
# Wait (bounded) for a named render to appear: scripts/render.sh NAME [seconds]
for i in $(seq 1 $(( ${2:-240} / 3 ))); do [ -f "renders/$1.json" ] && exit 0; sleep 3; done
echo "timeout waiting for $1"; exit 1
