import fs from 'node:fs';
import path from 'node:path';

// The ESM build lands in dist/esm; mark it so Node and bundlers read it as ESM.
const target = path.resolve('dist/esm/package.json');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(target, JSON.stringify({ type: 'module' }, null, 2) + '\n');