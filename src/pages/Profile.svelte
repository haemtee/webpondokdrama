<script>
    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";
    import { isAuthenticated, user, checkAuth } from "../stores/auth.js";
    import { lang } from "../stores/lang.js";

    let history = [];
    let loading = true;
    let profile = null;
    let profileLoading = true;

    // Settings backed by localStorage (used by VideoPlayer)
    let videoRes = localStorage.getItem("dracin_res") || "1080p";
    let autoplayNext = localStorage.getItem("dracin_autoplay") !== "0";

    // Subscription action state
    let subBusy = false;
    let subMessage = "";

    onMount(async () => {
        if (!$isAuthenticated) {
            push("/login");
            return;
        }
        await Promise.all([fetchProfile(), fetchHistory()]);
    });

    async function fetchProfile() {
        profileLoading = true;
        try {
            const res = await fetch("/api/auth/me");
            if (res.ok) {
                const data = await res.json();
                profile = data.user;
            }
        } catch (e) {
            console.error("Failed to fetch profile", e);
        } finally {
            profileLoading = false;
        }
    }

    async function fetchHistory() {
        loading = true;
        try {
            const res = await fetch("/api/history");
            const data = await res.json();
            if (data.history) history = data.history;
        } catch (e) {
            console.error(e);
        } finally {
            loading = false;
        }
    }

    function setLang(value) {
        $lang = value;
    }

    function onResChange(e) {
        videoRes = e.target.value;
        localStorage.setItem("dracin_res", videoRes);
    }

    function onAutoplayToggle(e) {
        autoplayNext = e.target.checked;
        localStorage.setItem("dracin_autoplay", autoplayNext ? "1" : "0");
    }

    async function subscribe() {
        subBusy = true;
        subMessage = "";
        try {
            const res = await fetch("/api/auth/subscribe", { method: "POST" });
            const data = await res.json();
            if (res.ok) {
                subMessage =
                    $lang === "id"
                        ? "Berlangganan aktif!"
                        : "Subscription activated!";
                await fetchProfile();
                await checkAuth();
            } else {
                subMessage =
                    data.error ||
                    ($lang === "id"
                        ? "Gagal berlangganan"
                        : "Subscription failed");
            }
        } catch (e) {
            subMessage =
                $lang === "id" ? "Kesalahan jaringan" : "Network error";
        } finally {
            subBusy = false;
        }
    }

    async function cancelSubscription() {
        if (
            !confirm(
                $lang === "id"
                    ? "Yakin ingin membatalkan langganan?"
                    : "Cancel your subscription?",
            )
        )
            return;
        subBusy = true;
        subMessage = "";
        try {
            const res = await fetch("/api/auth/cancel", { method: "POST" });
            const data = await res.json();
            if (res.ok) {
                subMessage =
                    $lang === "id"
                        ? "Langganan dibatalkan"
                        : "Subscription cancelled";
                await fetchProfile();
                await checkAuth();
            } else {
                subMessage =
                    data.error ||
                    ($lang === "id" ? "Gagal membatalkan" : "Cancel failed");
            }
        } catch (e) {
            subMessage =
                $lang === "id" ? "Kesalahan jaringan" : "Network error";
        } finally {
            subBusy = false;
        }
    }

    function formatTime(seconds) {
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}:${s < 10 ? "0" : ""}${s}`;
    }

    function formatDate(value) {
        if (!value) return "-";
        try {
            const d = new Date(value);
            return d.toLocaleDateString($lang === "id" ? "id-ID" : "en-US", {
                year: "numeric",
                month: "long",
                day: "numeric",
            });
        } catch {
            return String(value);
        }
    }

    $: subStatus = profile?.subscription_status || "inactive";
    $: subActive = subStatus === "active";
</script>

<div class="max-w-5xl mx-auto pb-16">
    <!-- Header card -->
    <div
        class="bg-dracin-card/80 backdrop-blur-md p-6 md:p-8 rounded-2xl border border-white/5 mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4 shadow-xl"
    >
        <div class="flex items-center gap-4">
            <div
                class="w-16 h-16 rounded-full bg-gradient-to-tr from-dracin-primary to-dracin-secondary flex items-center justify-center text-2xl font-extrabold text-white shadow-lg"
            >
                {($user?.email || "U")[0].toUpperCase()}
            </div>
            <div>
                <h1 class="text-2xl md:text-3xl font-extrabold text-white">
                    {$user?.email || "—"}
                </h1>
                <div class="flex flex-wrap gap-2 mt-2 items-center text-sm">
                    <span
                        class="px-2 py-0.5 rounded-full bg-white/10 border border-white/10 text-gray-300 capitalize"
                    >
                        {$user?.role || "user"}
                    </span>
                    {#if profile?.created_at}
                        <span class="text-gray-500">
                            {$lang === "id" ? "Bergabung" : "Joined"}
                            {formatDate(profile.created_at)}
                        </span>
                    {/if}
                </div>
            </div>
        </div>
        {#if $user?.role === "admin"}
            <button
                on:click={() => push("/admin")}
                class="bg-dracin-primary hover:bg-rose-700 text-white px-5 py-2.5 rounded-full font-bold text-sm self-start md:self-auto"
            >
                Admin Dashboard
            </button>
        {/if}
    </div>

    <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-10">
        <!-- Subscription -->
        <section
            class="bg-dracin-card/80 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-xl"
        >
            <h2 class="text-lg font-bold text-white mb-1">
                {$lang === "id" ? "Langganan" : "Subscription"}
            </h2>
            <p class="text-sm text-gray-400 mb-4">
                {$lang === "id"
                    ? "Buka konten premium Dracinema"
                    : "Unlock Dracinema premium content"}
            </p>

            <div class="flex items-center gap-3 mb-4">
                <span
                    class="px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider {subActive
                        ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                        : 'bg-white/5 text-gray-400 border border-white/10'}"
                >
                    {subActive
                        ? $lang === "id"
                            ? "Aktif"
                            : "Active"
                        : $lang === "id"
                          ? "Tidak aktif"
                          : "Inactive"}
                </span>
                {#if subActive && profile?.subscription_expires_at}
                    <span class="text-sm text-gray-400">
                        {$lang === "id" ? "sampai" : "until"}
                        {formatDate(profile.subscription_expires_at)}
                    </span>
                {/if}
            </div>

            {#if profileLoading}
                <div class="h-10 bg-white/5 rounded animate-pulse"></div>
            {:else if subActive}
                <button
                    on:click={cancelSubscription}
                    disabled={subBusy}
                    class="bg-white/10 hover:bg-white/20 text-white font-medium py-2 px-4 rounded-lg disabled:opacity-50"
                >
                    {$lang === "id"
                        ? "Batalkan langganan"
                        : "Cancel subscription"}
                </button>
            {:else}
                <button
                    on:click={subscribe}
                    disabled={subBusy}
                    class="bg-dracin-primary hover:bg-rose-600 text-white font-bold py-2.5 px-5 rounded-full shadow-[0_0_15px_rgba(225,29,72,0.3)] disabled:opacity-50"
                >
                    {subBusy
                        ? $lang === "id"
                            ? "Memproses..."
                            : "Processing..."
                        : $lang === "id"
                          ? "Berlangganan sekarang"
                          : "Subscribe now"}
                </button>
            {/if}

            {#if subMessage}
                <p class="text-xs mt-3 text-gray-300">{subMessage}</p>
            {/if}
        </section>

        <!-- Preferences -->
        <section
            class="bg-dracin-card/80 backdrop-blur-md p-6 rounded-2xl border border-white/5 shadow-xl"
        >
            <h2 class="text-lg font-bold text-white mb-4">
                {$lang === "id" ? "Preferensi" : "Preferences"}
            </h2>

            <!-- Language -->
            <div class="mb-5">
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2"
                >
                    {$lang === "id" ? "Bahasa" : "Language"}
                </label>
                <div class="flex gap-2">
                    {#each [{ id: "id", name: "Indonesia" }, { id: "en", name: "English" }] as opt}
                        <button
                            class="px-4 py-2 rounded-full text-sm font-semibold border transition-colors {$lang ===
                            opt.id
                                ? 'bg-white text-black border-white'
                                : 'bg-dracin-card text-gray-300 border-white/10 hover:bg-white/10'}"
                            on:click={() => setLang(opt.id)}
                        >
                            {opt.name}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Video resolution -->
            <div class="mb-5">
                <label
                    class="block text-xs font-bold uppercase tracking-wider text-gray-400 mb-2"
                >
                    {$lang === "id"
                        ? "Kualitas video bawaan"
                        : "Default video quality"}
                </label>
                <select
                    value={videoRes}
                    on:change={onResChange}
                    class="bg-dracin-card border border-white/10 rounded-lg px-3 py-2 text-white focus:border-dracin-primary outline-none"
                >
                    <option value="1080p">1080p (FHD)</option>
                    <option value="720p">720p (HD)</option>
                    <option value="480p">480p (SD)</option>
                </select>
            </div>

            <!-- Autoplay -->
            <div>
                <label
                    class="flex items-center gap-3 cursor-pointer select-none"
                >
                    <input
                        type="checkbox"
                        checked={autoplayNext}
                        on:change={onAutoplayToggle}
                        class="w-4 h-4 rounded border-white/20 bg-dracin-card accent-dracin-primary"
                    />
                    <span class="text-sm text-gray-200">
                        {$lang === "id"
                            ? "Putar otomatis episode berikutnya"
                            : "Autoplay next episode"}
                    </span>
                </label>
            </div>
        </section>
    </div>

    <!-- Continue watching -->
    <h2 class="text-xl font-bold text-white mb-4">
        {$lang === "id" ? "Lanjutkan menonton" : "Continue watching"}
    </h2>

    {#if loading}
        <div class="text-center p-8 text-gray-500">
            {$lang === "id" ? "Memuat riwayat..." : "Loading history..."}
        </div>
    {:else if history.length === 0}
        <div
            class="bg-dracin-card/50 p-8 rounded-2xl text-center border border-white/5 text-gray-400"
        >
            {$lang === "id"
                ? "Kamu belum menonton apa pun."
                : "You haven't watched anything yet."}
        </div>
    {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {#each history as item}
                <button
                    type="button"
                    class="text-left bg-dracin-card border border-white/5 rounded-xl overflow-hidden flex flex-col hover:border-dracin-primary transition-colors cursor-pointer"
                    on:click={() =>
                        push(
                            `/watch/flickreels/${item.drama_id}/${item.episode_id}`,
                        )}
                >
                    <div
                        class="h-32 bg-gray-900 flex items-center justify-center text-gray-700 font-bold relative"
                    >
                        DRAMA POSTER
                        <div
                            class="absolute bottom-0 left-0 h-1 bg-dracin-primary w-full opacity-70"
                        ></div>
                    </div>
                    <div class="p-4">
                        <h3 class="font-bold text-white">{item.drama_id}</h3>
                        <p class="text-sm text-gray-400">
                            Episode: {item.episode_id}
                        </p>
                        <p
                            class="text-xs text-dracin-primary mt-2 font-semibold"
                        >
                            {$lang === "id" ? "Berhenti di" : "Left off at"}
                            {formatTime(item.last_position_seconds)}
                        </p>
                    </div>
                </button>
            {/each}
        </div>
    {/if}
</div>
