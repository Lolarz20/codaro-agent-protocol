import { rmSync } from 'node:fs';
for (const path of ['dist', 'artifacts', 'coverage']) rmSync(new URL('../' + path, import.meta.url), { recursive: true, force: true });
