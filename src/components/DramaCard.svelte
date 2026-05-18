<script>
    import { push } from 'svelte-spa-router';
    
    export let id;
    export let provider;
    export let title;
    export let poster;
    export let episodeCount;
    export let tags = []; // Accept tags
    
    function watchDrama() {
        // Episode 1 as default
        push(`/watch/${provider}/${id}/1`);
    }
</script>

<div 
    class="group relative bg-dracin-card border border-white/5 rounded-xl overflow-hidden flex flex-col hover:border-white/10 hover:shadow-2xl hover:shadow-dracin-primary/10 transition-all duration-300 cursor-pointer w-full h-full" 
    on:click={watchDrama}
>
    <!-- Aspect ratio roughly 2:3 or 3:4 for vertical posters -->
    <div class="relative w-full aspect-[2/3] bg-gray-900 overflow-hidden">
        {#if poster}
            <img src={poster} alt={title} class="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform duration-500" loading="lazy" />
        {:else}
            <div class="absolute inset-0 flex items-center justify-center text-gray-700 font-bold p-4 text-center">
                NO IMAGE
            </div>
        {/if}
        
        <!-- Episode Count Badge -->
        <div class="absolute top-2 right-2 bg-black/60 backdrop-blur-sm text-white text-xs font-bold px-2 py-1 rounded shadow-lg border border-white/10 z-10">
            {episodeCount} Ep
        </div>
        
        <!-- Gradient Overlay for text legibility -->
        <div class="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent opacity-80 z-0"></div>
        
        <!-- Hover Play Icon Overlay -->
        <div class="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-300 z-10 bg-black/20">
            <div class="w-12 h-12 rounded-full bg-dracin-primary/90 flex items-center justify-center shadow-[0_0_20px_rgba(225,29,72,0.6)] backdrop-blur-sm transform scale-90 group-hover:scale-100 transition-transform duration-300">
                <svg class="w-6 h-6 text-white ml-1" fill="currentColor" viewBox="0 0 20 20"><path d="M4 4l12 6-12 6z"></path></svg>
            </div>
        </div>
        
        <!-- Text Content over image -->
        <div class="absolute bottom-0 left-0 w-full p-3 z-10 flex flex-col justify-end">
            <h3 class="font-bold text-sm md:text-base text-white line-clamp-2 leading-tight drop-shadow-md mb-1">{title}</h3>
            {#if tags && tags.length > 0}
                <div class="flex flex-wrap gap-1 mt-1">
                    {#each tags.slice(0, 2) as tag}
                        <span class="text-[10px] md:text-xs text-gray-300 line-clamp-1">{tag}</span>
                        {#if tag !== tags.slice(0, 2)[tags.slice(0, 2).length - 1]}
                            <span class="text-gray-500 text-[10px]">&bull;</span>
                        {/if}
                    {/each}
                </div>
            {/if}
        </div>
    </div>
</div>
