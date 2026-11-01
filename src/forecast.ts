/** Where looping a queue takes the character's fatigue, with the game's own `fatigue.ts`. */

import { afterPlay, BAR_ZONES, restedFatigue, STRAIN_CAP, warmupBar, type Fatigue } from '@oss-idle/shared/fatigue';
import type { QueuedMap } from './queue.js';

/** One play at some fatigue: its wall clock, and the minutes it counts for and strained. */
export type Played = { durationSec: number; lengthMin: number; strained: number };

export type Sample = { at: number; minutes: number; bar: number };

export type Outlook = {
	samples: Sample[];
	plays: number;
	/** Seconds of one time through the queue. */
	loopSec: number;
	/** Fatigue minutes one time through the queue adds, from where it started. */
	loopDrift: number;
	/** Seconds in that the bar first leaves the peak zone, if it does. */
	leavesAt?: number;
};

/** The fatigue minutes at `bar` on the warm-up bar, which only rises with them. */
export const minutesAtBar = (bar: number, gear: number): number => {
	let lo = 0;
	let hi = STRAIN_CAP;
	for (let i = 0; i < 40; i++) {
		const mid = (lo + hi) / 2;
		if (warmupBar(mid, gear) < bar) lo = mid;
		else hi = mid;
	}
	return hi;
};

/** Each play of the queue in order, its repeats spelled out; the head only has the repeats it has left. */
export const expand = (queue: readonly QueuedMap[]): QueuedMap[] =>
	queue.flatMap((map, i) => Array<QueuedMap>(Math.max(1, map.repeat - (i === 0 ? map.played : 0))).fill(map));

/** Step `sessionSec` through the queue, looping, asking `play` what each play does at its fatigue. */
export const forecast = async (
	queue: readonly QueuedMap[],
	{ startMinutes, gear, delaySec, sessionSec, play, cancelled = () => false }: {
		startMinutes: number;
		gear: number;
		delaySec: number;
		sessionSec: number;
		play: (map: QueuedMap, minutes: number) => Promise<Played>;
		cancelled?: () => boolean;
	},
): Promise<Outlook> => {
	const order = expand(queue);
	const out: Outlook = {
		samples: [{ at: 0, minutes: startMinutes, bar: warmupBar(startMinutes, gear) }],
		plays: 0,
		loopSec: 0,
		loopDrift: 0,
	};
	if (!order.length) return out;
	let fatigue: Fatigue = { at: 0, minutes: startMinutes };
	let t = 0;
	for (let i = 0; t < sessionSec && !cancelled(); i++) {
		const at = await play(order[i % order.length]!, restedFatigue(fatigue, t * 1000));
		t += at.durationSec;
		fatigue = afterPlay(fatigue, at.lengthMin, at.strained, t * 1000);
		const bar = warmupBar(fatigue.minutes, gear);
		out.samples.push({ at: t, minutes: fatigue.minutes, bar });
		out.plays++;
		if (out.leavesAt === undefined && (bar < BAR_ZONES[0] || bar > BAR_ZONES[1])) out.leavesAt = t;
		t += delaySec;
		if (out.plays === order.length) {
			out.loopSec = t;
			out.loopDrift = restedFatigue(fatigue, t * 1000) - startMinutes;
		}
	}
	return out;
};
