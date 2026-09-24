import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import ts from 'typescript';

const SRC_ROOT = resolve(process.cwd(), 'src');

const LEGACY_TERMS = /10man|tenman/i;

// Compatibility identifiers that must remain stable even though they contain
// the legacy substring. Add a documented entry here instead of weakening the
// guard when an intentional legacy reference is required.
const ALLOWLIST_PATTERNS: RegExp[] = [
  // Module and import paths are internal wiring, not player-facing text.
  /['"][^'"]*[/\\]tenman[/\\][^'"]*['"]/i,
  // Signed-component signing domains and generation constants are treated as
  // wire-protocol identifiers; changing them would invalidate live controls.
  /['"]10man-(queue|player-hub|steam-account|match|match-ops|result-dispute|queue-admin|party|match-admin|player-admin)\\0['"]/i,
  /['"]10man-admin-generation['"]/i,
  /['"]10man-admin\\0['"]/i,
  // Internal HTTP/admin cookie names are not rendered to players.
  /['"]__Secure-tenman_\w+['"]/i,
  // Internal ownership markers used for resource provenance checks.
  /['"]tenman:[^'"]*['"]/i,
  // DatHost provisional server names are infrastructure labels, not Discord UI copy.
  /[`'"]10man-[^`'"]*[`'"]/i,
  // Static asset paths and filenames are kept for path stability.
  /['"]tenman['"]/i,
  /['"]office-club-cs2-10man-thumbnail-512\.png['"]/i,
  // DatHost provisional server names and ownership markers are infrastructure
  // labels, not Discord player-facing copy.
  /[`'"]10man-[^`'"]*\$\{/i,
  /[`'"]tenman:[^`'"]*\$\{/i,
];

function* walk(dir: string): Generator<string> {
  for (const entry of readdirSync(dir)) {
    const path = resolve(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      // Generated Prisma client is allowed to use legacy model names verbatim.
      if (entry === 'generated') continue;
      yield* walk(path);
    } else if (stats.isFile() && path.endsWith('.ts')) {
      yield path;
    }
  }
}

function extractStringLiterals(source: string): string[] {
  const sourceFile = ts.createSourceFile('scan.ts', source, ts.ScriptTarget.Latest, true);
  const literals: string[] = [];

  function visit(node: ts.Node): void {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      literals.push(node.getText(sourceFile));
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return literals;
}

describe('user-facing terminology regression guard', () => {
  it('contains no public-facing 10man/tenman branding in TypeScript string literals', () => {
    const violations: string[] = [];

    for (const path of walk(SRC_ROOT)) {
      const source = readFileSync(path, 'utf-8');
      const literals = extractStringLiterals(source);

      for (const literal of literals) {
        let cleaned = literal;
        for (const pattern of ALLOWLIST_PATTERNS) {
          cleaned = cleaned.replace(new RegExp(pattern.source, `${pattern.flags}g`), '');
        }
        if (LEGACY_TERMS.test(cleaned)) {
          violations.push(path);
          break;
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
