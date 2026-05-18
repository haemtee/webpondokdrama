<script>
    import { onMount } from 'svelte';
    import { isAuthenticated, user } from '../stores/auth.js';
    import { push } from 'svelte-spa-router';

    let history = [];
    let loading = true;

    onMount(async () => {
        if (!$isAuthenticated) {
            push('/login');
            return;
        }

        try {
            const res = await fetch('/api/history');
            const data = await res.json();
            if (data.history) {
                history = data.history;
            }
        } catch (e) {
            console.error(e);
        } finally {
            loading = false;
        }
    });

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? '0' : ''}${s}`;
    }
</script>

<div class="max-w-5xl mx-auto">
    <div class="bg-dracin-card p-6 rounded-xl border border-gray-800 mb-8 flex justify-between items-center">
        <div>
            <h1 class="text-2xl font-bold text-dracin-text">Welcome, {$user?.email}</h1>
            <p class="text-dracin-muted">Role: <span class="capitalize font-semibold text-dracin-primary">{$user?.role}</span></p>
        </div>
        {#if $user?.role === 'admin'}
            <button on:click={() => push('/admin')} class="bg-dracin-primary hover:bg-rose-700 text-white px-4 py-2 rounded font-bold">Admin Dashboard</button>
        {/if}
    </div>

    <h2 class="text-xl font-bold mb-4 border-b border-gray-800 pb-2">Continue Watching</h2>
    
    {#if loading}
        <div class="text-center p-8 text-gray-500">Loading history...</div>
    {:else if history.length === 0}
        <div class="bg-dracin-card p-8 rounded-xl text-center border border-gray-800 text-gray-400">
            You haven't watched anything yet.
        </div>
    {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {#each history as item}
                <div class="bg-dracin-card border border-gray-800 rounded-lg overflow-hidden flex flex-col hover:border-dracin-primary transition-colors cursor-pointer" on:click={() => push(`/watch/flickreels/${item.drama_id}/${item.episode_id}`)}>
                    <!-- Placeholder image -->
                    <div class="h-32 bg-gray-900 flex items-center justify-center text-gray-700 font-bold relative">
                        DRAMA POSTER
                        <div class="absolute bottom-0 left-0 h-1 bg-dracin-primary w-full opacity-70"></div>
                    </div>
                    <div class="p-4">
                        <h3 class="font-bold text-lg">{item.drama_id}</h3>
                        <p class="text-sm text-gray-400">Episode: {item.episode_id}</p>
                        <p class="text-xs text-dracin-primary mt-2 font-semibold">Left off at {formatTime(item.last_position_seconds)}</p>
                    </div>
                </div>
            {/each}
        </div>
    {/if}
</div>
