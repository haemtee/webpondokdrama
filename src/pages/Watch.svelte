<script>
    import { onMount } from 'svelte';
    import { push } from 'svelte-spa-router';
    import VideoPlayer from '../components/VideoPlayer.svelte';
    import { lang } from '../stores/lang.js';
    
    export let params = {};
    
    $: provider = params.provider;
    $: drama_id = params.drama_id;
    $: episode_id = params.episode_id;
    
    let dramaDetails = null;
    let loading = true;
    
    onMount(() => {
        fetchDetails();
    });

    $: if ($lang) {
        fetchDetails();
    }

    async function fetchDetails() {
        loading = true;
        try {
            const res = await fetch(`/api/detail/${provider}/${drama_id}?lang=${$lang}`);
            if (res.ok) {
                dramaDetails = await res.json();
            }
        } catch (e) {
            console.error("Failed to fetch drama details", e);
        } finally {
            loading = false;
        }
    }
</script>

<div class="min-h-screen bg-dracin-dark relative">
    <!-- Cinematic Background Glow based on poster if available -->
    {#if dramaDetails && dramaDetails.poster}
        <div class="absolute inset-0 overflow-hidden pointer-events-none opacity-20 z-0">
            <img src={dramaDetails.poster} alt="" class="w-full h-full object-cover blur-[100px] scale-110" />
            <div class="absolute inset-0 bg-gradient-to-b from-dracin-dark/40 via-dracin-dark/80 to-dracin-dark"></div>
        </div>
    {/if}

    <div class="max-w-6xl mx-auto pt-6 pb-20 px-4 md:px-8 relative z-10">
        <button 
            on:click={() => push('/')}
            class="mb-6 flex items-center text-gray-400 hover:text-white transition-colors font-medium text-sm"
        >
            <svg class="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            {$lang === 'id' ? 'Kembali' : 'Back'}
        </button>

        <div class="mb-6 flex flex-col md:flex-row md:justify-between md:items-end gap-4">
            <div>
                <h1 class="text-3xl md:text-4xl font-extrabold text-white mb-2 drop-shadow-md">
                    {dramaDetails ? dramaDetails.title : `Loading...`}
                </h1>
                <p class="text-gray-400 font-medium">
                    {$lang === 'id' ? 'Episode' : 'Episode'} <span class="text-white text-lg ml-1">{episode_id}</span>
                    {#if dramaDetails && dramaDetails.totalEpisodes}
                        <span class="opacity-60"> / {dramaDetails.totalEpisodes}</span>
                    {/if}
                </p>
            </div>
            <div class="flex items-center gap-2">
                <span class="text-xs uppercase font-bold tracking-wider text-gray-400">Sumber:</span>
                <span class="text-xs bg-white/10 border border-white/20 px-3 py-1 rounded-full text-white font-bold tracking-wide uppercase shadow-sm">
                    {provider}
                </span>
            </div>
        </div>
        
        <!-- Player Section -->
        <div class="rounded-2xl overflow-hidden shadow-2xl border border-white/5 bg-black">
            <!-- Ensure video player component passes lang down if needed, but we mainly need it for detail view -->
            <!-- For video streaming API, we can pass it as a prop or it reads from url/store -->
            <VideoPlayer provider={provider} dramaId={drama_id} videoId={episode_id} lang={$lang} />
        </div>
        
        <!-- Episode Navigation & Selection -->
        <div class="mt-6">
            <div class="flex justify-between items-center mb-4">
                <button 
                    class="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={parseInt(episode_id) <= 1}
                    on:click={() => push(`/watch/${provider}/${drama_id}/${parseInt(episode_id) - 1}`)}
                >
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"></path></svg>
                    {$lang === 'id' ? 'Sebelumnya' : 'Previous'}
                </button>
                <button 
                    class="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded-lg flex items-center gap-2 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    disabled={!dramaDetails || parseInt(episode_id) >= (dramaDetails.totalEpisodes || 999)}
                    on:click={() => push(`/watch/${provider}/${drama_id}/${parseInt(episode_id) + 1}`)}
                >
                    {$lang === 'id' ? 'Selanjutnya' : 'Next'}
                    <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
            </div>
            
            {#if dramaDetails && dramaDetails.totalEpisodes}
                <div class="bg-dracin-card/80 backdrop-blur-md p-4 rounded-xl border border-white/5 shadow-xl">
                    <h3 class="text-sm font-bold text-gray-400 mb-3 uppercase tracking-wider">
                        {$lang === 'id' ? 'Daftar Episode' : 'Episodes'}
                    </h3>
                    <div class="grid grid-cols-5 sm:grid-cols-8 md:grid-cols-10 lg:grid-cols-12 gap-2 max-h-48 overflow-y-auto pr-2">
                        {#each Array(dramaDetails.totalEpisodes) as _, i}
                            <button 
                                class="py-2 rounded text-sm font-medium transition-colors border {parseInt(episode_id) === (i + 1) ? 'bg-dracin-primary text-white border-dracin-primary shadow-[0_0_10px_rgba(225,29,72,0.5)]' : 'bg-white/5 text-gray-300 border-white/10 hover:bg-white/10 hover:text-white'}"
                                on:click={() => push(`/watch/${provider}/${drama_id}/${i + 1}`)}
                            >
                                {i + 1}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
        
        <!-- Details Section -->
        <div class="mt-10 bg-dracin-card/80 backdrop-blur-md p-6 md:p-8 rounded-2xl border border-white/5 shadow-xl flex flex-col md:flex-row gap-8">
            {#if loading && !dramaDetails}
                <div class="animate-pulse flex flex-col md:flex-row space-y-4 md:space-y-0 md:space-x-8 w-full">
                    <div class="rounded-xl bg-white/5 h-64 w-40 mx-auto md:mx-0"></div>
                    <div class="flex-1 space-y-4 py-2">
                        <div class="h-6 bg-white/5 rounded w-1/4"></div>
                        <div class="space-y-3">
                            <div class="h-4 bg-white/5 rounded"></div>
                            <div class="h-4 bg-white/5 rounded"></div>
                            <div class="h-4 bg-white/5 rounded w-5/6"></div>
                        </div>
                    </div>
                </div>
            {:else if dramaDetails}
                {#if dramaDetails.poster}
                    <div class="flex-shrink-0 mx-auto md:mx-0">
                        <img src={dramaDetails.poster} alt={dramaDetails.title} class="w-40 md:w-56 rounded-xl shadow-2xl object-cover aspect-[2/3] border border-white/10 transform hover:scale-105 transition-transform duration-500" />
                    </div>
                {/if}
                <div class="flex-grow">
                    <h3 class="text-xl font-bold mb-4 pb-2 border-b border-white/10 text-white">Sinopsis</h3>
                    <p class="text-gray-300 leading-relaxed text-sm md:text-base whitespace-pre-line font-light">
                        {dramaDetails.intro || ($lang === 'id' ? 'Deskripsi tidak tersedia.' : 'Description not available.')}
                    </p>
                    {#if dramaDetails.tags && dramaDetails.tags.length > 0}
                        <div class="mt-6">
                            <h4 class="text-xs font-bold text-gray-500 uppercase tracking-wider mb-2">Tags</h4>
                            <div class="flex flex-wrap gap-2">
                                {#each dramaDetails.tags as tag}
                                    <span class="text-xs bg-white/5 text-gray-300 px-3 py-1.5 rounded-full border border-white/10 hover:bg-white/10 transition-colors cursor-default">
                                        {tag}
                                    </span>
                                {/each}
                            </div>
                        </div>
                    {/if}
                </div>
            {:else}
                <div class="w-full text-center text-gray-500 py-8">
                    {$lang === 'id' ? 'Detail tidak tersedia untuk drama ini.' : 'Details not available for this drama.'}
                </div>
            {/if}
        </div>
    </div>
</div>
