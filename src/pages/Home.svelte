<script>
    import { onMount } from "svelte";
    import { push } from "svelte-spa-router";
    import DramaCard from "../components/DramaCard.svelte";
    import { isAuthenticated } from "../stores/auth.js";
    import { lang } from "../stores/lang.js";

    let provider = localStorage.getItem("dracin_provider") || "flickreels";
    let dramas = [];
    let categories = [];
    let providers = [];
    let loading = true;
    let loadingCats = false;
    let error = "";

    let searchQuery = "";
    let selectedCategoryId = "";
    let selectedCategoryName = "";

    // Derived state for UI
    $: heroDrama = dramas.length > 0 ? dramas[0] : null;
    $: listDramas = dramas.length > 1 ? dramas.slice(1) : [];

    onMount(async () => {
        if (!$isAuthenticated) {
            push("/login");
            return;
        }
        await fetchProviders();
        fetchData();
    });

    async function fetchProviders() {
        try {
            const res = await fetch("/api/providers");
            if (res.ok) {
                const data = await res.json();
                providers = data.providers || [];
                // If saved provider is no longer supported, fall back to first.
                if (
                    !providers.find((p) => p.id === provider) &&
                    providers.length
                ) {
                    provider = providers[0].id;
                }
            }
        } catch (e) {
            console.error("Failed to load providers", e);
        }
    }

    // Refetch when language changes
    $: if ($lang) {
        if ($isAuthenticated) {
            fetchData();
        }
    }

    function fetchData() {
        if (searchQuery.trim()) {
            fetchSearch();
        } else if (selectedCategoryId) {
            fetchCategoryContent();
        } else {
            fetchHome();
        }
        fetchCategories();
    }

    async function fetchHome() {
        loading = true;
        error = "";
        try {
            const res = await fetch(`/api/home/${provider}?lang=${$lang}`);
            if (res.ok) {
                const data = await res.json();
                dramas = data.dramas || [];
            } else {
                error = "Failed to load dramas";
            }
        } catch (e) {
            error = "Network error";
        } finally {
            loading = false;
        }
    }

    async function fetchCategoryContent() {
        loading = true;
        error = "";
        try {
            const res = await fetch(
                `/api/category-content/${provider}?id=${selectedCategoryId}&name=${encodeURIComponent(selectedCategoryName)}&lang=${$lang}`,
            );
            if (res.ok) {
                const data = await res.json();
                dramas = data.dramas || [];
            } else {
                error = "Failed to load category content";
            }
        } catch (e) {
            error = "Network error";
        } finally {
            loading = false;
        }
    }

    async function fetchCategories() {
        loadingCats = true;
        try {
            const res = await fetch(
                `/api/categories/${provider}?lang=${$lang}`,
            );
            if (res.ok) {
                const data = await res.json();
                categories = data.categories || [];
            }
        } catch (e) {
            console.error(e);
        } finally {
            loadingCats = false;
        }
    }

    async function fetchSearch() {
        if (!searchQuery.trim()) {
            if (selectedCategoryId) {
                fetchCategoryContent();
            } else {
                fetchHome();
            }
            return;
        }
        loading = true;
        error = "";
        try {
            const res = await fetch(
                `/api/search/${provider}?q=${encodeURIComponent(searchQuery)}&lang=${$lang}`,
            );
            if (res.ok) {
                const data = await res.json();
                dramas = data.dramas || [];
            } else {
                error = "Search failed";
            }
        } catch (e) {
            error = "Network error";
        } finally {
            loading = false;
        }
    }

    function switchProvider(newProvider) {
        if (provider === newProvider) return;
        provider = newProvider;
        localStorage.setItem("dracin_provider", provider);
        searchQuery = "";
        selectedCategoryId = "";
        selectedCategoryName = "";
        categories = [];
        fetchData();
    }

    $: providerLabel =
        providers.find((p) => p.id === provider)?.name ||
        provider.charAt(0).toUpperCase() + provider.slice(1);

    function handleCategorySelect(cat) {
        const catId = cat.id || cat.tag_id || cat.nav_id || cat.category_id;
        if (selectedCategoryId === catId) {
            selectedCategoryId = "";
            selectedCategoryName = "";
            fetchHome();
            return;
        }

        selectedCategoryId = catId;
        selectedCategoryName =
            cat.name || cat.tag_name || cat.nav_name || cat.display_name || "";

        searchQuery = "";
        fetchCategoryContent();
    }

    function playHero() {
        if (heroDrama) {
            push(`/watch/${provider}/${heroDrama.id}/1`);
        }
    }
</script>

<div class="min-h-screen bg-dracin-dark pb-20">
    {#if loading && !dramas.length}
        <div class="flex justify-center items-center h-screen">
            <div
                class="animate-spin rounded-full h-16 w-16 border-t-4 border-b-4 border-dracin-primary"
            ></div>
        </div>
    {:else if error}
        <div class="container mx-auto pt-32 px-4">
            <div
                class="bg-red-500/10 border border-red-500/50 text-red-400 p-8 rounded-2xl text-center max-w-lg mx-auto"
            >
                <svg
                    class="w-16 h-16 mx-auto mb-4 text-red-500 opacity-80"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                    ><path
                        stroke-linecap="round"
                        stroke-linejoin="round"
                        stroke-width="2"
                        d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                    ></path></svg
                >
                <p class="font-bold text-xl mb-2">
                    Oops! Something went wrong.
                </p>
                <p class="mb-6 opacity-80">{error}</p>
                <button
                    on:click={fetchData}
                    class="bg-red-600 hover:bg-red-700 text-white font-bold px-8 py-3 rounded-full transition-colors shadow-lg"
                    >Try Again</button
                >
            </div>
        </div>
    {:else}
        <!-- Hero Section -->
        {#if heroDrama && !searchQuery}
            <div class="relative w-full h-[60vh] md:h-[80vh] bg-black">
                <!-- Hero Background -->
                <div class="absolute inset-0">
                    <img
                        src={heroDrama.poster}
                        alt={heroDrama.title}
                        class="w-full h-full object-cover opacity-60"
                    />
                    <!-- Gradients for blending -->
                    <div
                        class="absolute inset-0 bg-gradient-to-t from-dracin-dark via-dracin-dark/40 to-transparent"
                    ></div>
                    <div
                        class="absolute inset-0 bg-gradient-to-r from-dracin-dark via-dracin-dark/60 to-transparent"
                    ></div>
                </div>

                <!-- Hero Content -->
                <div
                    class="absolute bottom-0 left-0 w-full p-6 md:p-16 pb-12 md:pb-24 z-10 flex flex-col justify-end"
                >
                    <div class="max-w-3xl">
                        <div class="flex items-center gap-3 mb-4">
                            <span
                                class="bg-dracin-primary text-white text-xs font-bold px-3 py-1 rounded-sm tracking-wider uppercase"
                                >Trending</span
                            >
                            <span class="text-gray-300 text-sm font-medium"
                                >{heroDrama.episode_count} Episodes</span
                            >
                        </div>
                        <h1
                            class="text-4xl md:text-6xl font-extrabold text-white mb-6 leading-tight drop-shadow-lg"
                        >
                            {heroDrama.title}
                        </h1>
                        <div class="flex gap-4">
                            <button
                                on:click={playHero}
                                class="bg-white hover:bg-gray-200 text-black font-bold py-3 px-8 rounded flex items-center gap-2 transition-transform transform hover:scale-105"
                            >
                                <svg
                                    class="w-6 h-6"
                                    fill="currentColor"
                                    viewBox="0 0 20 20"
                                    ><path d="M4 4l12 6-12 6z"></path></svg
                                >
                                {$lang === "id"
                                    ? "Tonton Sekarang"
                                    : "Watch Now"}
                            </button>
                            <button
                                class="bg-white/20 hover:bg-white/30 backdrop-blur-md text-white border border-white/30 font-bold py-3 px-8 rounded flex items-center gap-2 transition-colors"
                            >
                                <svg
                                    class="w-6 h-6"
                                    fill="none"
                                    stroke="currentColor"
                                    viewBox="0 0 24 24"
                                    ><path
                                        stroke-linecap="round"
                                        stroke-linejoin="round"
                                        stroke-width="2"
                                        d="M12 6v6m0 0v6m0-6h6m-6 0H6"
                                    ></path></svg
                                >
                                {$lang === "id" ? "Daftar Saya" : "My List"}
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        {/if}

        <div class="container mx-auto px-4 md:px-8 mt-[-2rem] relative z-20">
            <!-- Search Bar -->
            <div class="mb-10 max-w-2xl">
                <div class="relative">
                    <div
                        class="absolute inset-y-0 left-0 pl-4 flex items-center pointer-events-none"
                    >
                        <svg
                            class="w-5 h-5 text-gray-400"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                            ><path
                                stroke-linecap="round"
                                stroke-linejoin="round"
                                stroke-width="2"
                                d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
                            ></path></svg
                        >
                    </div>
                    <input
                        type="text"
                        bind:value={searchQuery}
                        on:keydown={(e) => e.key === "Enter" && fetchSearch()}
                        placeholder={$lang === "id"
                            ? "Cari drama..."
                            : "Search dramas..."}
                        class="w-full bg-dracin-card/80 backdrop-blur-sm border border-white/10 rounded-full py-4 pl-12 pr-32 focus:border-dracin-primary focus:ring-1 focus:ring-dracin-primary outline-none transition-all text-white placeholder-gray-500 shadow-xl"
                    />
                    <button
                        on:click={fetchSearch}
                        class="absolute inset-y-1 right-1 bg-dracin-primary hover:bg-rose-600 text-white px-6 rounded-full font-bold transition-colors"
                    >
                        Search
                    </button>
                </div>
            </div>

            <!-- Provider Pills (Telusuri per Sumber) -->
            <div class="mb-6">
                <h2
                    class="text-xl font-bold mb-4 text-white flex items-center gap-2"
                >
                    <span class="text-dracin-primary">⚡</span>
                    {$lang === "id"
                        ? "Telusuri per Sumber"
                        : "Browse by Source"}
                </h2>
                <div
                    class="flex gap-3 overflow-x-auto pb-4 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0"
                >
                    {#each providers as prov}
                        <button
                            class="whitespace-nowrap px-6 py-3 rounded-full text-sm font-bold transition-all border {provider ===
                            prov.id
                                ? 'bg-white text-black border-white shadow-lg'
                                : 'bg-dracin-card/50 text-gray-300 border-white/10 hover:bg-white/10 hover:text-white'}"
                            on:click={() => switchProvider(prov.id)}
                        >
                            {prov.name}
                        </button>
                    {/each}
                </div>
            </div>

            <!-- Categories Pills -->
            {#if categories.length > 0 && !loadingCats}
                <div class="mb-12">
                    <div
                        class="flex gap-2 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:mx-0 md:px-0"
                    >
                        <button
                            class="whitespace-nowrap px-5 py-2 rounded-full text-sm font-semibold transition-all border {selectedCategoryId ===
                            ''
                                ? 'bg-dracin-primary text-white border-dracin-primary shadow-[0_0_10px_rgba(225,29,72,0.3)]'
                                : 'bg-dracin-card/50 text-gray-400 border-white/5 hover:bg-white/10 hover:text-white'}"
                            on:click={() => {
                                selectedCategoryId = "";
                                searchQuery = "";
                                fetchHome();
                            }}
                        >
                            {$lang === "id" ? "Semua" : "All"}
                        </button>
                        {#each categories as cat}
                            <button
                                class="whitespace-nowrap px-5 py-2 rounded-full text-sm font-semibold transition-all border {selectedCategoryId ===
                                (cat.id ||
                                    cat.tag_id ||
                                    cat.nav_id ||
                                    cat.category_id)
                                    ? 'bg-dracin-primary text-white border-dracin-primary shadow-[0_0_10px_rgba(225,29,72,0.3)]'
                                    : 'bg-dracin-card/50 text-gray-400 border-white/5 hover:bg-white/10 hover:text-white'}"
                                on:click={() => handleCategorySelect(cat)}
                            >
                                {cat.name ||
                                    cat.tag_name ||
                                    cat.nav_name ||
                                    cat.display_name}
                            </button>
                        {/each}
                    </div>
                </div>
            {/if}

            <!-- Content Grid / Rows -->
            {#if dramas.length === 0}
                <div
                    class="text-center p-16 bg-dracin-card/30 border border-white/5 rounded-2xl"
                >
                    <p class="text-gray-400 text-lg">
                        {$lang === "id"
                            ? "Tidak ada drama ditemukan."
                            : "No dramas found."}
                    </p>
                </div>
            {:else}
                <div class="mb-10">
                    <div class="flex justify-between items-end mb-6">
                        <h2 class="text-2xl font-bold text-white">
                            {searchQuery
                                ? $lang === "id"
                                    ? "Hasil Pencarian"
                                    : "Search Results"
                                : `${providerLabel} ${$lang === "id" ? "Populer" : "Popular"}`}
                        </h2>
                    </div>

                    <div
                        class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4 md:gap-6"
                    >
                        <!-- If searching, show all. If home, show listDramas (since hero is 0) -->
                        {#each searchQuery ? dramas : listDramas as drama}
                            <DramaCard
                                id={drama.id}
                                {provider}
                                title={drama.title}
                                poster={drama.poster}
                                episodeCount={drama.episode_count}
                            />
                        {/each}
                    </div>
                </div>
            {/if}
        </div>
    {/if}
</div>

<style>
    /* Hide scrollbar for the provider pills container but allow scrolling */
    .scrollbar-hide::-webkit-scrollbar {
        display: none;
    }
    .scrollbar-hide {
        -ms-overflow-style: none;
        scrollbar-width: none;
    }
</style>
