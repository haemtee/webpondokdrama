<script>
    import { onMount, onDestroy } from 'svelte';
    import Hls from 'hls.js';
    import Plyr from 'plyr';
    import { isAuthenticated } from '../stores/auth.js';

    export let videoId = 'test-video-id';
    export let provider = 'flickreels';
    export let dramaId = 'drama-123';
    export let lang = 'id';
    
    let videoElement;
    let player;
    let hls;
    
    let currentRes = localStorage.getItem('dracin_res') || '1080p';
    let lastPosition = 0;
    
    let isPortrait = false;
    let lastTap = 0;
    
    // Config for debounce
    let syncTimeout;

    async function fetchVideoStream(res, l) {
        try {
            const resData = await fetch(`/api/video/${provider}/${dramaId}/${videoId}?res=${res}&lang=${l}`);
            const data = await resData.json();
            if (data.source) {
                loadVideo(data.source);
            }
        } catch (e) {
            console.error('Failed to fetch video stream', e);
        }
    }

    function loadVideo(source) {
        if (!Hls.isSupported()) {
            videoElement.src = source;
            initPlyr();
            if (player) {
                player.play().catch(err => console.warn("Autoplay prevented", err));
            }
            return;
        }

        if (hls) {
            hls.destroy();
        }

        hls = new Hls();
        hls.loadSource(source);
        hls.attachMedia(videoElement);
        hls.on(Hls.Events.MANIFEST_PARSED, function () {
            initPlyr();
            // Try to resume
            if (lastPosition > 0) {
                videoElement.currentTime = lastPosition;
            }
            if (player) {
                player.play().catch(err => console.warn("Autoplay prevented", err));
            }
        });
    }

    function initPlyr() {
        if (player) return;
        player = new Plyr(videoElement, {
            controls: ['play-large', 'play', 'progress', 'current-time', 'mute', 'volume', 'captions', 'settings', 'pip', 'airplay', 'fullscreen'],
            seekTime: 10,
        });
    }

    function handleLoadedMetadata() {
        if (videoElement) {
            isPortrait = videoElement.videoWidth < videoElement.videoHeight;
        }
    }

    function handlePointerUp(e) {
        const currentTime = new Date().getTime();
        const tapLength = currentTime - lastTap;
        
        if (tapLength < 300 && tapLength > 0) {
            // It's a double tap
            const rect = e.currentTarget.getBoundingClientRect();
            // Fallback for touches or standard click
            const clientX = e.changedTouches ? e.changedTouches[0].clientX : e.clientX;
            const x = clientX - rect.left;
            
            if (x < rect.width / 3) {
                if (player) player.rewind(10);
            } else if (x > (rect.width * 2 / 3)) {
                if (player) player.forward(10);
            } else {
                // Middle third
                if (player) player.togglePlay();
            }
        }
        lastTap = currentTime;
    }

    function syncHistory() {
        if (!$isAuthenticated) return;
        const currentTime = Math.floor(videoElement.currentTime);
        if (currentTime === lastPosition) return;
        
        lastPosition = currentTime;
        
        // Debounced API call
        clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            fetch('/api/history/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    drama_id: dramaId,
                    episode_id: videoId,
                    last_position_seconds: currentTime
                })
            }).catch(console.error);
        }, 10000); // 10 seconds debounce
    }

    let loadedId = null;

    $: if (videoElement && (videoId !== loadedId || lang)) {
        // If the ID changed, reset position. If just lang changed, keep position.
        if (videoId !== loadedId) {
            lastPosition = 0;
            loadedId = videoId;
        }
        fetchVideoStream(currentRes, lang);
    }

    onMount(() => {
        // Initialization handled by reactive statement
    });

    onDestroy(() => {
        if (hls) hls.destroy();
        if (player) player.destroy();
        clearTimeout(syncTimeout);
        
        // Final sync on unmount without debounce
        if ($isAuthenticated && videoElement) {
             fetch('/api/history/update', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    drama_id: dramaId,
                    episode_id: videoId,
                    last_position_seconds: Math.floor(videoElement.currentTime)
                })
            }).catch(console.error);
        }
    });

    function handleResChange(e) {
        currentRes = e.target.value;
        localStorage.setItem('dracin_res', currentRes);
        const currentTime = videoElement.currentTime;
        lastPosition = currentTime; // save to resume
        fetchVideoStream(currentRes, lang);
    }
</script>

<div class="bg-dracin-card p-4 rounded-xl shadow-lg border border-gray-800">
    <!-- Custom Top Controls for Server/Language Selection -->
    <div class="flex justify-between items-center mb-4 text-sm">
        <div class="flex gap-4">
            <div class="flex flex-col">
                <label class="text-gray-400 mb-1 text-xs uppercase font-bold tracking-wider">Resolution</label>
                <select 
                    class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 focus:border-dracin-primary outline-none"
                    value={currentRes} on:change={handleResChange}
                >
                    <option value="1080p">1080p (FHD)</option>
                    <option value="720p">720p (HD)</option>
                    <option value="480p">480p (SD)</option>
                </select>
            </div>
        </div>
        
        <div class="text-xs bg-dracin-primary/20 text-dracin-primary px-3 py-1.5 rounded-full font-bold">
            Provider: {provider.toUpperCase()}
        </div>
    </div>
    
    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div 
        class="rounded-lg overflow-hidden bg-black relative {isPortrait ? 'aspect-[9/16] max-h-[80vh] w-auto mx-auto' : 'aspect-video w-full'}"
        on:pointerup={handlePointerUp}
    >
        <video 
            bind:this={videoElement} 
            on:timeupdate={syncHistory}
            on:loadedmetadata={handleLoadedMetadata}
            class="w-full h-full"
            crossorigin="anonymous"
            playsinline>
        </video>
    </div>
</div>

<style>
    /* Ensure plyr is contained */
    :global(.plyr) {
        border-radius: 0.5rem;
        height: 100%;
        width: 100%;
    }
</style>
