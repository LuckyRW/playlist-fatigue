/** The fatigue forecast, against plays whose strain is known. */
import { build } from 'esbuild';
import { rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolveGameRoot } from './resolve-game.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { sharedSourcePlugin, tsExtensionPlugin } = await import('@oss-idle/addon-sdk/build');
const game = resolveGameRoot();
const entry = join(root, 'src/.test-entry.ts');
const out = join(root, '.test.mjs');
writeFileSync(entry, `export * from './forecast.js';\nexport { warmupBar } from '@oss-idle/shared/fatigue';\n`);
await build({
	entryPoints: [entry], outfile: out, bundle: true, format: 'esm', platform: 'node',
	target: 'es2022', logLevel: 'error', absWorkingDir: root,
	plugins: [sharedSourcePlugin(join(game.root, 'packages/shared/src')), tsExtensionPlugin()],
});
const m = await import(pathToFileURL(out).href);
rmSync(entry);
rmSync(out);

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { ok ? pass++ : (fail++, console.log('  FAIL:', name, extra)); };
const map = (id, repeat = 1, played = 0) => ({ beatmapId: id, rate: 1, mods: [], repeat, played });
const base = { startMinutes: 100, gear: 0, delaySec: 30, sessionSec: 3600 };

check('repeats are spelled out, the head less what it played', m.expand([map(1, 3, 1), map(2, 2)]).map(p => p.beatmapId).join() === '1,1,2,2');

for (const bar of [0.2, 0.5, 0.7, 0.9]) {
	check(`the bar reads back to its minutes (${bar})`, Math.abs(m.warmupBar(m.minutesAtBar(bar, 0), 0) - bar) < 1e-3);
}

const asked = [];
const hard = await m.forecast([map(1), map(2)], { ...base, play: async one => { asked.push(one.beatmapId); return { durationSec: 120, lengthMin: 2, strained: 2 }; } });
check('fully strained plays tire', hard.samples.at(-1).minutes > 100, hard.samples.at(-1).minutes);
check('it loops the queue', asked.slice(0, 4).join() === '1,2,1,2');
check('a loop is its plays and gaps', hard.loopSec === 300, hard.loopSec);
check('a loop drifts up', hard.loopDrift > 0, hard.loopDrift);

const easy = await m.forecast([map(1)], { ...base, play: async () => ({ durationSec: 120, lengthMin: 2, strained: 0 }) });
check('plays without strain rest', easy.loopDrift < 0 && easy.samples.at(-1).minutes < 100, easy.loopDrift);

const none = await m.forecast([], { ...base, play: async () => { throw new Error('no plays'); } });
check('an empty queue plays nothing', none.plays === 0 && none.samples.length === 1);

console.log(`${pass} passed, ${fail} failed`);
if (fail) process.exitCode = 1;
