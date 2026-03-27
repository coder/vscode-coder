#!/usr/bin/env bash

# Prints each argument on its own line, so tests can verify exact args.
for arg in "$@"; do
  echo "$arg"
done
