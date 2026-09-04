<script lang="ts">
	import { resolve } from '$app/paths';
	import ThemeToggle from '$lib/components/ThemeToggle.svelte';
	import favicon from '$lib/assets/favicon.svg';
	import './layout.css';

	let { children, data } = $props();
</script>

<svelte:head><link rel="icon" href={favicon} /></svelte:head>

<div class="platform-shell">
	<header class="platform-header">
		<a href={resolve('/')} class="platform-mark">Golden Svelte Platform</a>
		<ThemeToggle initialMode={data.themeMode} />
	</header>
	<main>{@render children()}</main>
</div>
