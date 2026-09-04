<script lang="ts">
	import { browser } from '$app/environment';
	import * as m from '$lib/paraglide/messages';
	import { themeConfig } from '$lib/theme/config';
	import type { ThemeMode } from '$lib/theme';

	let { initialMode = themeConfig.defaultMode } = $props<{ initialMode?: ThemeMode }>();
	let selectedMode = $state<ThemeMode | undefined>(undefined);
	let mode = $derived(selectedMode ?? initialMode);

	async function changeTheme(next: ThemeMode) {
		selectedMode = next;
		if (browser) document.documentElement.dataset.theme = next;
		await fetch('/api/preferences/theme', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ mode: next })
		});
	}
</script>

<label class="theme-toggle">
	<span class="sr-only">{m.theme_toggle_label()}</span>
	<select
		aria-label={m.theme_toggle_label()}
		value={mode}
		onchange={(event) => changeTheme((event.currentTarget as HTMLSelectElement).value as ThemeMode)}
	>
		<option value="light">{m.theme_mode_light()}</option>
		<option value="dark">{m.theme_mode_dark()}</option>
		<option value="system">{m.theme_mode_system()}</option>
	</select>
</label>
