/**
 * @file dockerCompose.test.ts
 * @description Locks in that docker-compose.yml never falls back to a weak default
 *              Redis password. Parses the YAML directly rather than shelling out to
 *              `docker compose config` so this runs in any environment (including CI,
 *              where Docker may not be installed) without becoming an environment-
 *              dependent flaky test.
 * @author [Author Placeholder]
 * @created 2026-07-18
 */

import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

const COMPOSE_PATH = path.resolve(__dirname, '../../../docker-compose.yml');

function readComposeFile(): string {
  return fs.readFileSync(COMPOSE_PATH, 'utf-8');
}

describe('docker-compose.yml — REDIS_PASSWORD has no weak default', () => {
  it('does not use the :- (default-if-unset) interpolation form for REDIS_PASSWORD anywhere', () => {
    const contents = readComposeFile();
    expect(contents).not.toMatch(/\$\{REDIS_PASSWORD:-/);
  });

  it('uses the :? (required, fail-fast-if-unset) interpolation form for REDIS_PASSWORD', () => {
    const contents = readComposeFile();
    const matches = contents.match(/\$\{REDIS_PASSWORD:\?[^}]*\}/g);
    expect(matches).not.toBeNull();
    // Both --requirepass and the healthcheck's redis-cli -a must require it.
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('does not contain the literal string "changeme" anywhere (the old weak default)', () => {
    const contents = readComposeFile();
    expect(contents.toLowerCase()).not.toContain('changeme');
  });
});
