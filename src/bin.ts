#!/usr/bin/env node
import { main } from './cli.js';

// Si la salida se corta (arbres … | head), se termina sin traza.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') process.exit(0);
  throw error;
});

main(process.argv.slice(2)).then((code) => {
  process.exitCode = code;
});
