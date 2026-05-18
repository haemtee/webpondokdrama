<script>
    import { onMount, onDestroy } from "svelte";
    import Hls from "hls.js";
    import Plyr from "plyr";
    import { isAuthenticated } from "../stores/auth.js";
    import { subtitlePrefs } from "../stores/subtitle.js";
    import { track, trackVideoProgress } from "../stores/analytics.js";

    export let videoId = "test-video-id";
    export let provider = "flickreels";
    export let dramaId = "drama-123";
    export let lang = "id";

    let videoElement;
    let player;
    let hls;

    let currentRes = localStorage.getItem("dracin_res") || "1080p";
    let availableQualities = []; // names returned by backend
    let lastPosition = 0;

    let isPortrait = false;
    let lastTap = 0;

    let syncTimeout;

    // ---- subtitles ----
    // The list of available subtitle tracks from backend (already proxied
    // through /api/subtitle so the browser receives WebVTT regardless of
    // upstream format).
    let availableSubs = []; // [{ language, label, url, format }]

    // The currently active <track> DOM element. We keep its `mode` set to
    // 'hidden' so the browser still parses cues and fires `cuechange`, but
    // does NOT render them itself. We render them in `currentCueText`.
    let activeTrackEl = null;
    let currentCueText = "";

    // Settings panel toggle
    let showSubtitleMenu = false;

    // Analytics: only emit `video_start` once per (drama, episode) load and
    // `video_complete` once when the user crosses 95% of the duration.
    let startTracked = false;
    let completeTracked = false;

    // When true, the next fetchVideoStream() call appends ?refresh=1 to bypass
    // the backend cache. We set this from the HLS error handler when an
    // upstream signed URL has expired and playback fails.
    let needsRefresh = false;

    async function fetchVideoStream(res, l, { force = false } = {}) {
        try {
            const params = new URLSearchParams({
                res: res || "",
                lang: l || "",
            });
            if (force || needsRefresh) {
                params.set("refresh", "1");
                needsRefresh = false;
            }
            const resData = await fetch(
                `/api/video/${provider}/${dramaId}/${videoId}?${params.toString()}`,
            );
            const data = await resData.json();
            if (data.source) {
                availableSubs = data.subtitles || [];
                availableQualities = Object.keys(data.qualities || {});
                loadVideo(data.source);

                // Reset active track when episode/source changes.
                detachActiveTrack();
                applySubtitlePrefs();
            }
        } catch (e) {
            console.error("Failed to fetch video stream", e);
        }
    }

    function loadVideo(source) {
        if (!Hls.isSupported()) {
            videoElement.src = source;
            initPlyr();
            if (player) {
                player
                    .play()
                    .catch((err) => console.warn("Autoplay prevented", err));
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
            if (lastPosition > 0) {
                videoElement.currentTime = lastPosition;
            }
            if (player) {
                player
                    .play()
                    .catch((err) => console.warn("Autoplay prevented", err));
            }
            // Record the start once the manifest is parsed and ready to play.
            if (!startTracked) {
                startTracked = true;
                track("video_start", {
                    provider,
                    drama_id: dramaId,
                    episode_id: videoId,
                });
            }
        });

        // Detect a stale signed URL and recover automatically. The most
        // common case is the upstream CDN returning 403 because its `exp=`
        // token has passed. We try once with ?refresh=1 to make the backend
        // skip its cache and fetch a freshly signed URL.
        hls.on(Hls.Events.ERROR, (_e, data) => {
            if (!data.fatal) return;
            const isNetwork = data.type === Hls.ErrorTypes.NETWORK_ERROR;
            const looksLikeStaleSig =
                isNetwork &&
                (data.response?.code === 403 ||
                    data.response?.code === 404 ||
                    data.details === "manifestLoadError" ||
                    data.details === "fragLoadError");
            if (looksLikeStaleSig && !staleRetryDone) {
                console.warn(
                    "[VideoPlayer] stale stream URL detected, refreshing…",
                );
                staleRetryDone = true;
                lastPosition = Math.floor(videoElement.currentTime || 0);
                fetchVideoStream(currentRes, lang, { force: true });
            }
        });
    }

    // Set to true after we've already tried a refresh for this episode so we
    // don't loop forever if the upstream is genuinely down.
    let staleRetryDone = false;

    function initPlyr() {
        if (player) return;
        player = new Plyr(videoElement, {
            // We render subtitles ourselves, so the 'captions' control is
            // intentionally omitted. The custom subtitle button in our top
            // bar handles enable/disable + selection.
            controls: [
                "play-large",
                "play",
                "progress",
                "current-time",
                "mute",
                "volume",
                "settings",
                "pip",
                "airplay",
                "fullscreen",
            ],
            seekTime: 10,
            captions: { active: false, update: false },
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
            const rect = e.currentTarget.getBoundingClientRect();
            const clientX = e.changedTouches
                ? e.changedTouches[0].clientX
                : e.clientX;
            const x = clientX - rect.left;

            if (x < rect.width / 3) {
                if (player) player.rewind(10);
            } else if (x > (rect.width * 2) / 3) {
                if (player) player.forward(10);
            } else {
                if (player) player.togglePlay();
            }
        }
        lastTap = currentTime;
    }

    function syncHistory() {
        if (!$isAuthenticated) return;
        const currentTime = Math.floor(videoElement.currentTime);

        // Throttled progress event (every ~30s). Goes through analytics
        // tracker, not history. We do this even when currentTime is unchanged
        // so that a paused-but-active session still pings periodically — the
        // tracker itself enforces the 30s throttle.
        trackVideoProgress({
            provider,
            drama_id: dramaId,
            episode_id: videoId,
            position: currentTime,
        });

        // Detect "completion" once per episode: >= 95% of the known duration.
        if (
            !completeTracked &&
            videoElement.duration &&
            currentTime / videoElement.duration >= 0.95
        ) {
            completeTracked = true;
            track("video_complete", {
                provider,
                drama_id: dramaId,
                episode_id: videoId,
                metadata: {
                    duration_seconds: Math.floor(videoElement.duration),
                },
            });
        }

        if (currentTime === lastPosition) return;
        lastPosition = currentTime;

        clearTimeout(syncTimeout);
        syncTimeout = setTimeout(() => {
            fetch("/api/history/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    drama_id: dramaId,
                    episode_id: videoId,
                    last_position_seconds: currentTime,
                }),
            }).catch(console.error);
        }, 10000);
    }

    let loadedId = null;

    $: if (videoElement && (videoId !== loadedId || lang)) {
        if (videoId !== loadedId) {
            lastPosition = 0;
            loadedId = videoId;
            staleRetryDone = false;
            // New episode loaded: reset the per-episode analytics flags so
            // we'll emit fresh start/complete events.
            startTracked = false;
            completeTracked = false;
        }
        fetchVideoStream(currentRes, lang);
    }

    // For non-HLS sources (e.g. plain MP4 from moboreels) the <video> element
    // emits a generic `error` event when the upstream signed URL is rejected.
    // Treat it the same as the HLS NETWORK_ERROR path: refetch once with
    // ?refresh=1 to get a freshly signed URL.
    function handleVideoError() {
        if (!videoElement || !videoElement.error) return;
        if (staleRetryDone) return;
        // MEDIA_ERR_NETWORK = 2, MEDIA_ERR_SRC_NOT_SUPPORTED = 4 — both can
        // mean the CDN returned 403/404 mid-load.
        const code = videoElement.error.code;
        if (code !== 2 && code !== 4) return;
        console.warn(
            "[VideoPlayer] native video error",
            code,
            "- refreshing stream",
        );
        staleRetryDone = true;
        lastPosition = Math.floor(videoElement.currentTime || 0);
        fetchVideoStream(currentRes, lang, { force: true });
    }

    onMount(() => {
        // Initialization handled by reactive statement
    });

    onDestroy(() => {
        if (hls) hls.destroy();
        if (player) player.destroy();
        clearTimeout(syncTimeout);

        if ($isAuthenticated && videoElement) {
            fetch("/api/history/update", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    drama_id: dramaId,
                    episode_id: videoId,
                    last_position_seconds: Math.floor(videoElement.currentTime),
                }),
            }).catch(console.error);
        }
    });

    function handleResChange(e) {
        currentRes = e.target.value;
        localStorage.setItem("dracin_res", currentRes);
        const currentTime = videoElement.currentTime;
        lastPosition = currentTime;
        fetchVideoStream(currentRes, lang);
    }

    // ---- subtitle plumbing ----
    //
    // We attach a single <track> element on the fly when the user picks a
    // language, set its mode to 'hidden' so the cue list parses but the
    // browser does not paint, then read `track.activeCues` on `cuechange`.
    //
    // This approach lets us position and size captions however we want via
    // CSS, decoupled from any browser/Plyr defaults.

    function detachActiveTrack() {
        if (activeTrackEl) {
            activeTrackEl.removeEventListener("cuechange", handleCueChange);
            try {
                activeTrackEl.remove();
            } catch (_) {
                /* ignore */
            }
            activeTrackEl = null;
        }
        currentCueText = "";
    }

    function attachTrack(sub) {
        detachActiveTrack();
        if (!videoElement || !sub) return;

        const trackEl = document.createElement("track");
        trackEl.kind = "subtitles";
        trackEl.label = sub.label;
        trackEl.srclang = (sub.language || "").split("-")[0] || "id";
        trackEl.src = sub.url; // already /api/subtitle?url=...
        // Default not selected. We'll switch it to 'hidden' once the
        // browser has loaded its cues, in handleTrackLoad.
        trackEl.default = false;

        videoElement.appendChild(trackEl);

        // The TextTrack live object is exposed via `.track` once the
        // <track> element is parsed. We listen on the TextTrack rather
        // than the element for `cuechange`.
        const tt = trackEl.track;
        tt.mode = "hidden";

        const onCueChange = () => {
            const cues = tt.activeCues;
            if (!cues || cues.length === 0) {
                currentCueText = "";
                return;
            }
            const parts = [];
            for (let i = 0; i < cues.length; i++) {
                parts.push(cues[i].text);
            }
            currentCueText = parts.join("\n");
        };
        tt.addEventListener("cuechange", onCueChange);

        // Save references on the element so we can clean up.
        activeTrackEl = trackEl;
        activeTrackEl._textTrack = tt;
        activeTrackEl._cueChangeHandler = onCueChange;
    }

    function handleCueChange() {
        // Stub used by detachActiveTrack to remove the listener if it was
        // ever attached on the element. Real listener is on the TextTrack.
        if (activeTrackEl?._textTrack && activeTrackEl?._cueChangeHandler) {
            activeTrackEl._textTrack.removeEventListener(
                "cuechange",
                activeTrackEl._cueChangeHandler,
            );
        }
    }

    function applySubtitlePrefs() {
        const prefs = $subtitlePrefs;
        if (!prefs.enabled) {
            detachActiveTrack();
            return;
        }
        if (!availableSubs.length) return;

        // Pick the requested language, or fall back to the user's UI lang,
        // or the first available track.
        let chosen =
            availableSubs.find(
                (s) => s.language?.toLowerCase() === prefs.language,
            ) ||
            availableSubs.find((s) => s.language?.startsWith(lang)) ||
            availableSubs[0];

        attachTrack(chosen);
    }

    function toggleSubtitle() {
        $subtitlePrefs = {
            ...$subtitlePrefs,
            enabled: !$subtitlePrefs.enabled,
        };
        applySubtitlePrefs();
    }

    function selectSubLanguage(language) {
        $subtitlePrefs = {
            ...$subtitlePrefs,
            language: language,
            enabled: true,
        };
        applySubtitlePrefs();
    }

    function setFontSize(px) {
        $subtitlePrefs = { ...$subtitlePrefs, fontSize: px };
    }

    function setPosition(percent) {
        $subtitlePrefs = { ...$subtitlePrefs, position: percent };
    }

    // Reactive: when prefs change at runtime (e.g. another component edits
    // them), reapply.
    $: if (videoElement && availableSubs.length) {
        // re-evaluate when enabled/language changes; size/position are pure CSS
        $subtitlePrefs.enabled, $subtitlePrefs.language;
        applySubtitlePrefs();
    }
</script>

<div
    class="bg-dracin-card p-4 rounded-xl shadow-lg border border-gray-800 relative"
>
    <!-- Custom Top Controls for Server / Language / Subtitle -->
    <div class="flex flex-wrap justify-between items-center mb-4 text-sm gap-3">
        <div class="flex flex-wrap gap-3 items-end">
            <div class="flex flex-col">
                <label
                    class="text-gray-400 mb-1 text-xs uppercase font-bold tracking-wider"
                    >Resolution</label
                >
                <select
                    class="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 focus:border-dracin-primary outline-none"
                    value={currentRes}
                    on:change={handleResChange}
                >
                    <option value="1080p">1080p (FHD)</option>
                    <option value="720p">720p (HD)</option>
                    <option value="480p">480p (SD)</option>
                </select>
            </div>

            <!-- Subtitle button -->
            <div class="flex flex-col relative">
                <span
                    class="text-gray-400 mb-1 text-xs uppercase font-bold tracking-wider"
                    >Subtitle</span
                >
                <button
                    type="button"
                    class="px-3 py-1.5 rounded border outline-none flex items-center gap-2 transition-colors {availableSubs.length
                        ? 'bg-gray-800 border-gray-700 hover:border-dracin-primary text-white'
                        : 'bg-gray-900 border-gray-800 text-gray-600 cursor-not-allowed'}"
                    disabled={!availableSubs.length}
                    on:click={() => (showSubtitleMenu = !showSubtitleMenu)}
                    title={availableSubs.length
                        ? "Pengaturan subtitle"
                        : "Subtitle tidak tersedia"}
                >
                    <svg
                        class="w-4 h-4"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="2"
                    >
                        <rect x="3" y="6" width="18" height="12" rx="2"></rect>
                        <line x1="7" y1="14" x2="11" y2="14"></line>
                        <line x1="13" y1="14" x2="17" y2="14"></line>
                    </svg>
                    {#if !availableSubs.length}
                        <span class="text-xs">Tidak tersedia</span>
                    {:else if $subtitlePrefs.enabled}
                        <span class="text-xs"
                            >{(
                                $subtitlePrefs.language ||
                                availableSubs[0]?.language ||
                                "auto"
                            )
                                .toString()
                                .toUpperCase()}</span
                        >
                    {:else}
                        <span class="text-xs">Mati</span>
                    {/if}
                </button>

                {#if showSubtitleMenu && availableSubs.length}
                    <!-- svelte-ignore a11y-click-events-have-key-events -->
                    <!-- svelte-ignore a11y-no-static-element-interactions -->
                    <div
                        class="fixed inset-0 z-30"
                        on:click={() => (showSubtitleMenu = false)}
                    ></div>
                    <div
                        class="absolute top-full left-0 mt-2 w-72 bg-gray-900 border border-gray-700 rounded-lg shadow-2xl p-4 z-40 text-white"
                    >
                        <!-- Enable / disable -->
                        <div class="flex items-center justify-between mb-4">
                            <span class="font-bold">Subtitle</span>
                            <button
                                type="button"
                                class="px-3 py-1 rounded text-xs font-bold transition-colors {$subtitlePrefs.enabled
                                    ? 'bg-dracin-primary text-white'
                                    : 'bg-gray-700 text-gray-300'}"
                                on:click={toggleSubtitle}
                            >
                                {$subtitlePrefs.enabled ? "AKTIF" : "MATI"}
                            </button>
                        </div>

                        <!-- Language list -->
                        <div class="mb-4">
                            <p
                                class="text-xs uppercase tracking-wider text-gray-400 mb-2"
                            >
                                Bahasa
                            </p>
                            <div
                                class="max-h-40 overflow-y-auto pr-1 -mr-1 space-y-1"
                            >
                                {#each availableSubs as sub}
                                    <button
                                        type="button"
                                        class="w-full text-left px-3 py-1.5 rounded text-sm transition-colors {$subtitlePrefs.language ===
                                            sub.language &&
                                        $subtitlePrefs.enabled
                                            ? 'bg-dracin-primary text-white'
                                            : 'bg-gray-800 hover:bg-gray-700 text-gray-200'}"
                                        on:click={() =>
                                            selectSubLanguage(sub.language)}
                                    >
                                        {sub.label || sub.language}
                                    </button>
                                {/each}
                            </div>
                        </div>

                        <!-- Font size -->
                        <div class="mb-4">
                            <div class="flex items-center justify-between mb-2">
                                <span
                                    class="text-xs uppercase tracking-wider text-gray-400"
                                    >Ukuran</span
                                >
                                <span class="text-xs text-gray-300"
                                    >{$subtitlePrefs.fontSize}px</span
                                >
                            </div>
                            <input
                                type="range"
                                min="12"
                                max="40"
                                step="1"
                                value={$subtitlePrefs.fontSize}
                                on:input={(e) =>
                                    setFontSize(parseInt(e.target.value))}
                                class="w-full accent-dracin-primary"
                            />
                            <div
                                class="flex justify-between text-[10px] text-gray-500 mt-1"
                            >
                                <span>S</span><span>M</span><span>L</span>
                            </div>
                        </div>

                        <!-- Vertical position -->
                        <div>
                            <div class="flex items-center justify-between mb-2">
                                <span
                                    class="text-xs uppercase tracking-wider text-gray-400"
                                    >Posisi</span
                                >
                                <span class="text-xs text-gray-300"
                                    >{$subtitlePrefs.position}%</span
                                >
                            </div>
                            <input
                                type="range"
                                min="0"
                                max="100"
                                step="1"
                                value={$subtitlePrefs.position}
                                on:input={(e) =>
                                    setPosition(parseInt(e.target.value))}
                                class="w-full accent-dracin-primary"
                            />
                            <div
                                class="flex justify-between text-[10px] text-gray-500 mt-1"
                            >
                                <span>Atas</span><span>Tengah</span><span
                                    >Bawah</span
                                >
                            </div>
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <div
            class="text-xs bg-dracin-primary/20 text-dracin-primary px-3 py-1.5 rounded-full font-bold"
        >
            Provider: {provider.toUpperCase()}
        </div>
    </div>

    <!-- svelte-ignore a11y-no-static-element-interactions -->
    <div
        class="rounded-lg overflow-hidden bg-black relative {isPortrait
            ? 'aspect-[9/16] max-h-[80vh] w-auto mx-auto'
            : 'aspect-video w-full'}"
        on:pointerup={handlePointerUp}
    >
        <!-- svelte-ignore a11y-media-has-caption -->
        <video
            bind:this={videoElement}
            on:timeupdate={syncHistory}
            on:loadedmetadata={handleLoadedMetadata}
            on:error={handleVideoError}
            class="w-full h-full"
            crossorigin="anonymous"
            playsinline
        ></video>

        <!-- Custom subtitle overlay. Sits on top of <video>, position and
             font-size are bound to user preferences. We only render when
             subtitles are enabled and we have a current cue. -->
        {#if $subtitlePrefs.enabled && currentCueText}
            <div
                class="dracin-sub-overlay"
                style="
                    top: {$subtitlePrefs.position}%;
                    font-size: {$subtitlePrefs.fontSize}px;
                "
            >
                <span class="dracin-sub-text">
                    {#each currentCueText.split("\n") as line}
                        <span class="dracin-sub-line">{line}</span><br />
                    {/each}
                </span>
            </div>
        {/if}
    </div>
</div>

<style>
    /* Ensure plyr is contained */
    :global(.plyr) {
        border-radius: 0.5rem;
        height: 100%;
        width: 100%;
    }

    /* Subtitle overlay. We render captions ourselves so the user can move
       them anywhere and resize them freely. */
    .dracin-sub-overlay {
        position: absolute;
        left: 50%;
        transform: translate(-50%, -50%);
        max-width: 90%;
        text-align: center;
        pointer-events: none;
        z-index: 10;
        line-height: 1.3;
        font-weight: 600;
        text-shadow:
            0 0 4px rgba(0, 0, 0, 0.9),
            0 2px 6px rgba(0, 0, 0, 0.9);
    }
    .dracin-sub-text {
        color: #ffffff;
        background: rgba(0, 0, 0, 0.55);
        padding: 0.15em 0.5em;
        border-radius: 0.25em;
        box-decoration-break: clone;
        -webkit-box-decoration-break: clone;
        white-space: pre-wrap;
    }
    .dracin-sub-line {
        display: inline;
    }
</style>
