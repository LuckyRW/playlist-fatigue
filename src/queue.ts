/**
 * What the game is playing. It hands add-ons nothing for this, so walk React's
 * fiber tree from the elements it draws them with.
 */

import type { Mod } from '@oss-idle/shared/mods';

export type QueuedMap = { beatmapId: number; rate: number; mods: Mod[]; repeat: number; played: number };
export type Queue = { label: string; maps: QueuedMap[] };

type Fiber = { return?: Fiber | null; memoizedProps?: Record<string, unknown>; memoizedState?: unknown };
type Hook = { memoizedState?: unknown; next?: Hook | null };

const fiberOf = (element: Element | null): Fiber | undefined => {
	if (!element) return undefined;
	const key = Object.keys(element).find(name => name.startsWith('__reactFiber'));
	return key ? (element as unknown as Record<string, Fiber>)[key] : undefined;
};

/** Every piece of hook state of `fiber`. */
const hooksOf = (fiber: Fiber): unknown[] => {
	const states: unknown[] = [];
	let hook = fiber.memoizedState as Hook | null | undefined;
	while (hook && typeof hook === 'object' && 'next' in hook) {
		states.push(hook.memoizedState);
		hook = hook.next;
	}
	return states;
};

type GameQueue = {
	label?: string;
	entries: { repeat?: number; played?: number; beatmap: { metadata: { id: number }; lockedRate?: number; lockedMods?: Mod[] } }[];
};
const isQueue = (value: unknown): value is GameQueue =>
	!!value && typeof value === 'object' && Array.isArray((value as GameQueue).entries);

/** The queue the dock shows, or undefined when it shows none. */
export const readQueue = (): Queue | undefined => {
	for (let fiber = fiberOf(document.querySelector('.dock__source')); fiber; fiber = fiber.return ?? undefined) {
		for (const state of hooksOf(fiber)) {
			const found = [state, Array.isArray(state) ? state[0] : undefined].find(isQueue);
			if (found) {
				return {
					label: found.label ?? '',
					maps: found.entries.map(({ beatmap, repeat, played }) => ({
						beatmapId: beatmap.metadata.id,
						rate: beatmap.lockedRate ?? 1,
						mods: beatmap.lockedMods ?? [],
						repeat: repeat ?? 1,
						played: played ?? 0,
					})),
				};
			}
		}
	}
	return undefined;
};

/** The running play's warm-up bar, or undefined off the play screen. */
export const readWarmupBar = (): number | undefined => {
	for (let fiber = fiberOf(document.querySelector('.play__canvas')); fiber; fiber = fiber.return ?? undefined) {
		const play = fiber.memoizedProps?.play as { warmupBar?: unknown } | undefined;
		if (typeof play?.warmupBar === 'number') return play.warmupBar;
	}
	return undefined;
};
