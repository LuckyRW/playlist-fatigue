import { gameCharacter, playCountsSince } from '@oss-idle/addon-sdk';
import type { AddonApi, ApiSimulation } from '@oss-idle/shared/apiV2';
import { BAR_ZONES } from '@oss-idle/shared/fatigue';
import { LEAD_IN_MS } from '@oss-idle/shared/play';
import { Skills } from '@oss-idle/shared/rulesets/mania/4k/skills';
import { useRef, useState } from 'react';
import { forecast, minutesAtBar, type Outlook, type Played } from './forecast.js';
import { readQueue, readWarmupBar, type Queue, type QueuedMap } from './queue.js';

/** Plays of a map are simulated once per this many fatigue minutes: strain barely moves within it. */
const BUCKET_MINUTES = 15;
/** The sim API allows 1200 calls a minute. */
const CALL_SPACING_MS = 55;
const W = 760;
const H = 240;

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const num = (value: unknown) => (typeof value === 'number' ? value : 0);

const clock = (sec: number) => `${Math.floor(sec / 3600)}:${String(Math.floor(sec / 60) % 60).padStart(2, '0')}`;

/** The game stores its autopilot delay only once it is changed: 30 is its default. */
const autopilotDelay = (): number => {
	try {
		const stored: unknown = JSON.parse(localStorage.getItem('autopilotDelay') ?? 'null');
		return typeof stored === 'number' && stored >= 0 ? stored : 30;
	} catch {
		return 30;
	}
};

/** The `character` row, as the sim API takes it. */
const skillsOf = (row: Record<string, unknown>) => Object.fromEntries(Skills.map(name => [name, {
	level: num(row[name]),
	xp: num(row[`${name}XP`]),
	lifetime_xp: num(row[`${name}LifetimeXp`]),
	prestige: num(row[`${name}Prestige`]),
	upgrades: num(row[`${name}Upgrades`]),
	overdrive: num(row[`${name}Overdrive`]),
}]));

function Graph({ outlook, sessionSec }: { outlook: Outlook; sessionSec: number }) {
	const x = (at: number) => (at / sessionSec) * W;
	const y = (bar: number) => H - bar * H;
	return (
		<svg className="pf-graph" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Warm-up bar over time">
			<rect className="pf-peak" x={0} y={y(BAR_ZONES[1])} width={W} height={y(BAR_ZONES[0]) - y(BAR_ZONES[1])} />
			<polyline className="pf-line" points={outlook.samples.map(s => `${x(s.at).toFixed(1)},${y(s.bar).toFixed(1)}`).join(' ')} />
		</svg>
	);
}

export default function Panel({ open, onClose, api }: { open: boolean; onClose: () => void; api?: AddonApi }) {
	const [hours, setHours] = useState(6);
	/** Fatigue minutes typed in; empty reads them off the running play. */
	const [typed, setTyped] = useState('');
	const [queue, setQueue] = useState<Queue>();
	const [outlook, setOutlook] = useState<Outlook>();
	const [start, setStart] = useState<{ minutes: number; from: string }>();
	const [sessionSec, setSessionSec] = useState(hours * 3600);
	const [progress, setProgress] = useState<number>();
	const [error, setError] = useState('');
	const stop = useRef(false);

	const scan = async () => {
		setError('');
		setOutlook(undefined);
		stop.current = false;
		try {
			if (!api) throw new Error('This game hands add-ons no API: update oss!idle to 1.3.');
			const found = readQueue();
			if (!found?.maps.length) throw new Error('No queue is playing: start a playlist with autopilot first.');
			setQueue(found);
			const row = await gameCharacter.live() as unknown as Record<string, unknown>;
			const gear = num(row.staminaUpgrades);
			const bar = readWarmupBar();
			const asked = Number(typed);
			const startAt = typed.trim() !== '' && Number.isFinite(asked)
				? { minutes: Math.max(0, asked), from: 'typed in' }
				: bar !== undefined
					? { minutes: minutesAtBar(bar, gear), from: 'the running play' }
					: undefined;
			if (!startAt) throw new Error('Your fatigue can only be read on the play screen: open the running play and scan there, or type your fatigue minutes.');
			setStart(startAt);

			const playCounts = await playCountsSince(num(row.id), num(row.memoryResetAt));
			const asks = new Map<string, Promise<Played>>();
			let calls = 0;
			let nextCall = 0;
			const ask = async (map: QueuedMap, minutes: number): Promise<Played> => {
				const wait = Math.max(0, nextCall - Date.now());
				nextCall = Date.now() + wait + CALL_SPACING_MS;
				if (wait) await sleep(wait);
				const answer: ApiSimulation = await api.simulate({
					beatmap_id: map.beatmapId,
					rate: map.rate,
					mods: map.mods,
					generation: num(row.generation) || 1,
					strain_minutes: minutes,
					map_plays: playCounts[map.beatmapId] ?? 0,
					skills: skillsOf(row),
				});
				setProgress(++calls);
				const fullSec = map.lengthSec / map.rate;
				return {
					// a failed play ends early, but tires the character for the map's full length
					durationSec: LEAD_IN_MS / 1000 + (answer.passed ? fullSec : answer.fail_seconds ?? fullSec),
					lengthMin: fullSec / 60,
					strained: answer.strained_minutes,
				};
			};
			const seconds = hours * 3600;
			setSessionSec(seconds);
			setProgress(0);
			setOutlook(await forecast(found.maps, {
				startMinutes: startAt.minutes,
				gear,
				delaySec: autopilotDelay(),
				sessionSec: seconds,
				cancelled: () => stop.current,
				play: (map, minutes) => {
					const bucket = Math.round(minutes / BUCKET_MINUTES) * BUCKET_MINUTES;
					const key = `${map.beatmapId}@${map.rate}+${map.mods.join('')}~${bucket}`;
					let known = asks.get(key);
					if (!known) asks.set(key, known = ask(map, bucket));
					return known;
				},
			}));
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
		}
		setProgress(undefined);
	};

	return (
		<div className="pf-panel" hidden={!open}>
			<div className="pf-head">
				<h2>Playlist fatigue</h2>
				<button onClick={onClose} aria-label="Close">×</button>
			</div>
			<div className="pf-controls">
				<label>Hours <input type="number" min={1} max={48} value={hours} onChange={e => setHours(Math.min(48, Math.max(1, Number(e.target.value) || 1)))} /></label>
				<label title="Empty: read from the play screen">Start fatigue (min) <input value={typed} placeholder="from play screen" onChange={e => setTyped(e.target.value)} /></label>
				{progress === undefined
					? <button onClick={scan}>Scan</button>
					: <button onClick={() => { stop.current = true; }}>Stop ({progress} sims)</button>}
			</div>
			{error && <p className="pf-error">{error}</p>}
			{queue && <p>{queue.label || 'Queue'}: {queue.maps.length} maps{start ? `, from ${Math.round(start.minutes)} fatigue minutes (${start.from})` : ''}</p>}
			{outlook && (
				<>
					<Graph outlook={outlook} sessionSec={sessionSec} />
					<p className="pf-hint">The warm-up bar over {hours}h, 0 to full. The band is the peak zone.</p>
					<p>
						{outlook.leavesAt === undefined ? `Stays at peak for all ${hours}h.` : `Out of the peak zone after ${clock(outlook.leavesAt)}.`}
						{outlook.loopSec > 0 && ` One loop takes ${clock(outlook.loopSec)} and moves fatigue ${outlook.loopDrift >= 0 ? '+' : ''}${outlook.loopDrift.toFixed(1)} minutes.`}
						{` Ends at ${Math.round(outlook.samples.at(-1)!.minutes)} fatigue minutes.`}
					</p>
				</>
			)}
		</div>
	);
}
