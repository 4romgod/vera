#!/usr/bin/env node

import { VeraApiError } from '@vera/client';

import { runCli } from './main.ts';

try {
  process.exitCode = await runCli(process.argv.slice(2));
} catch (error) {
  if (error instanceof VeraApiError) {
    process.stderr.write(
      `Vera API error (${error.code}, HTTP ${String(error.status)}): ${error.message}\n`,
    );
  } else {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
  }
  process.exitCode = 1;
}
