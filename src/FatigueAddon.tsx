/** The panel stays mounted and is only hidden, so closing it keeps the graph. */

import { ReactAddon } from '@oss-idle/addon-sdk/react';
import type { AddonApi } from '@oss-idle/shared/apiV2';
import type { ReactNode } from 'react';
import Panel from './Panel.js';
import styles from './styles.css';

const TOGGLE = 'Ctrl+Shift+G';

export class FatigueAddon extends ReactAddon {

	private open = false;

	constructor() {
		super({ name: 'Playlist Fatigue', overlayId: 'playlist-fatigue', styles });
	}

	protected override async onReady(): Promise<void> {
		this.own(this.hotkeys.register(TOGGLE, () => this.toggle(), { allowInText: true }));
		this.log.info(`ready - press ${TOGGLE} to open`);
	}

	private toggle(): void {
		this.open = !this.open;
		this.refresh();
	}

	protected render(): ReactNode {
		return <Panel open={this.open} onClose={() => this.toggle()} api={(this.host as { api?: AddonApi } | undefined)?.api} />;
	}
}
