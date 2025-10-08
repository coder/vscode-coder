#!/usr/bin/env bash

if [[ $* == *--output* ]] ; then
  >&2 echo -n '$STDERR'
  exit 1
else
  echo -n '$STDOUT'
fi
