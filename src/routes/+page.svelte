<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<svelte:head><title>{m.app_name()}</title></svelte:head>

<section class="platform-home">
	<p class="eyebrow">Svelte 5 · Bun · PostgreSQL</p>
	<h1>{m.app_name()}</h1>
	<p>{m.app_loading()}</p>
</section>
