const Ansi = {
  green: '\u001B[32m',
  red: '\u001B[31m',
  bold: '\u001B[1m',
  reset: '\u001B[0m',
} as const;

export type DiagnosticResult = {
  case: string;
  passed: boolean;
  [key: string]: unknown;
};

export function formatDiagnosticResult(
  result: DiagnosticResult,
  options: { interactive: boolean; colors: boolean },
): string {
  if (!options.interactive) {
    return `${JSON.stringify(result)}\n`;
  }

  const symbol = result.passed ? '✓' : '✗';
  const status = result.passed ? 'PASS' : 'FAIL';
  const heading = `${symbol} ${status}  ${result.case}`;
  const styledHeading = options.colors
    ? `${Ansi.bold}${result.passed ? Ansi.green : Ansi.red}${heading}${Ansi.reset}`
    : heading;

  return `${styledHeading}\n${JSON.stringify(result, null, 2)}\n\n`;
}

export function writeDiagnosticResult(result: DiagnosticResult): void {
  const interactive = process.stdout.isTTY;
  process.stdout.write(
    formatDiagnosticResult(result, {
      interactive,
      colors: interactive && process.env.NO_COLOR === undefined,
    }),
  );
}
