<script>
    import { onMount, onDestroy, tick } from "svelte";
    import { isAuthenticated, user, authReady } from "../stores/auth.js";
    import { push } from "svelte-spa-router";
    import Chart from "chart.js/auto";

    // ---- state ----
    let days = 30; // selectable window
    let loading = true;
    let error = "";

    let overview = null;
    let timeseries = null;
    let topContent = [];
    let subscriptions = null;
    let eventBreakdown = [];
    let providerBreakdown = [];

    // Chart canvases + instances. Instances are tracked so we can `.destroy()`
    // them between data refreshes; Chart.js will throw "Canvas is already in
    // use" otherwise.
    let trendCanvas, eventsCanvas, providerCanvas;
    let trendChart, eventsChart, providerChart;

    // ---- access control ----
    // Wait for authReady to flip true so we don't redirect before the cookie
    // session has been verified.
    $: if ($authReady && (!$isAuthenticated || $user?.role !== "admin")) {
        push("/");
    }

    onMount(async () => {
        // Bail out cleanly if the user isn't an admin; the redirect above
        // handles UI navigation.
        if (!$isAuthenticated || $user?.role !== "admin") return;
        await loadAll();
    });

    onDestroy(() => {
        destroyCharts();
    });

    function destroyCharts() {
        for (const c of [trendChart, eventsChart, providerChart]) {
            try {
                c?.destroy();
            } catch (_) {
                /* ignore */
            }
        }
        trendChart = eventsChart = providerChart = null;
    }

    async function loadAll() {
        loading = true;
        error = "";
        try {
            const qs = `?days=${days}`;
            const [ovRes, tsRes, topRes, subRes, evRes, provRes] =
                await Promise.all([
                    fetch(`/api/admin/analytics/overview${qs}`),
                    fetch(`/api/admin/analytics/timeseries${qs}`),
                    fetch(`/api/admin/analytics/top-content${qs}&limit=10`),
                    fetch(`/api/admin/analytics/subscriptions${qs}`),
                    fetch(`/api/admin/analytics/events${qs}`),
                    fetch(`/api/admin/analytics/providers${qs}`),
                ]);

            // 403 from any of them means the user lost admin role mid-session.
            if (
                [ovRes, tsRes, topRes, subRes, evRes, provRes].some(
                    (r) => r.status === 403,
                )
            ) {
                error = "Access denied. Admin role is required.";
                return;
            }

            if (!ovRes.ok) throw new Error("overview");
            overview = await ovRes.json();
            timeseries = tsRes.ok ? await tsRes.json() : null;
            topContent = topRes.ok ? (await topRes.json()).items || [] : [];
            subscriptions = subRes.ok ? await subRes.json() : null;
            eventBreakdown = evRes.ok ? (await evRes.json()).items || [] : [];
            providerBreakdown = provRes.ok
                ? (await provRes.json()).items || []
                : [];

            // Wait for the {#if !loading} block to render the canvases before
            // we try to attach Chart.js to them.
            await tick();
            renderCharts();
        } catch (e) {
            console.error("[Admin] failed to load analytics:", e);
            error = "Failed to load analytics. Check the backend logs.";
        } finally {
            loading = false;
        }
    }

    async function changeRange(newDays) {
        if (newDays === days) return;
        days = newDays;
        await loadAll();
    }

    // ---- chart rendering ----

    function renderCharts() {
        destroyCharts();
        renderTrendChart();
        renderEventsChart();
        renderProviderChart();
    }

    // Standard dark-theme axis options for Chart.js. Centralized so all
    // charts on this page look consistent.
    const darkAxis = {
        ticks: { color: "#94a3b8" },
        grid: { color: "rgba(148, 163, 184, 0.1)" },
    };

    function renderTrendChart() {
        if (!trendCanvas || !timeseries) return;
        trendChart = new Chart(trendCanvas, {
            type: "line",
            data: {
                labels: timeseries.labels,
                datasets: [
                    {
                        label: "Active Users",
                        data: timeseries.activeUsers,
                        borderColor: "#22d3ee",
                        backgroundColor: "rgba(34, 211, 238, 0.15)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                    },
                    {
                        label: "Views",
                        data: timeseries.views,
                        borderColor: "#e11d48",
                        backgroundColor: "rgba(225, 29, 72, 0.15)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                    },
                    {
                        label: "Registrations",
                        data: timeseries.registrations,
                        borderColor: "#a855f7",
                        backgroundColor: "rgba(168, 85, 247, 0.15)",
                        borderWidth: 2,
                        fill: true,
                        tension: 0.35,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: { labels: { color: "#f8fafc" } },
                    tooltip: {
                        backgroundColor: "rgba(15, 23, 42, 0.95)",
                        titleColor: "#f8fafc",
                        bodyColor: "#cbd5e1",
                        borderColor: "rgba(148, 163, 184, 0.2)",
                        borderWidth: 1,
                    },
                },
                scales: { x: darkAxis, y: { ...darkAxis, beginAtZero: true } },
            },
        });
    }

    // A small, repeatable palette so each event/provider gets a distinguishable
    // colour without us having to hand-pick hex codes per slice.
    const palette = [
        "#e11d48",
        "#22d3ee",
        "#a855f7",
        "#facc15",
        "#34d399",
        "#f97316",
        "#3b82f6",
        "#ec4899",
        "#14b8a6",
        "#eab308",
        "#8b5cf6",
        "#10b981",
    ];

    function renderEventsChart() {
        if (!eventsCanvas) return;
        if (!eventBreakdown.length) return;
        eventsChart = new Chart(eventsCanvas, {
            type: "doughnut",
            data: {
                labels: eventBreakdown.map((e) => e.eventType),
                datasets: [
                    {
                        data: eventBreakdown.map((e) => e.count),
                        backgroundColor: eventBreakdown.map(
                            (_, i) => palette[i % palette.length],
                        ),
                        borderColor: "rgba(15, 23, 42, 0.9)",
                        borderWidth: 2,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: "right",
                        labels: { color: "#cbd5e1", boxWidth: 12 },
                    },
                },
            },
        });
    }

    function renderProviderChart() {
        if (!providerCanvas) return;
        if (!providerBreakdown.length) return;
        providerChart = new Chart(providerCanvas, {
            type: "bar",
            data: {
                labels: providerBreakdown.map((p) => p.provider),
                datasets: [
                    {
                        label: "Video starts",
                        data: providerBreakdown.map((p) => p.count),
                        backgroundColor: providerBreakdown.map(
                            (_, i) => palette[i % palette.length],
                        ),
                        borderRadius: 4,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: false } },
                scales: { x: darkAxis, y: { ...darkAxis, beginAtZero: true } },
            },
        });
    }

    // Format big numbers with thousands separators using the user's locale.
    function fmt(n) {
        if (n === null || n === undefined) return "—";
        return Number(n).toLocaleString();
    }
</script>

<div class="max-w-7xl mx-auto pb-20">
    <!-- Header -->
    <div
        class="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4"
    >
        <div>
            <h1 class="text-3xl md:text-4xl font-extrabold text-white mb-1">
                Analytics Dashboard
            </h1>
            <p class="text-gray-400">
                Pemantauan aktivitas platform dalam {days} hari terakhir.
            </p>
        </div>

        <!-- Range selector. We rerun all queries when the user picks a
             different window. -->
        <div
            class="flex items-center gap-2 bg-dracin-card/60 border border-white/10 p-1 rounded-full self-start md:self-auto"
        >
            {#each [7, 30, 90] as opt}
                <button
                    class="px-4 py-1.5 rounded-full text-sm font-semibold transition-colors {days ===
                    opt
                        ? 'bg-dracin-primary text-white shadow-[0_0_10px_rgba(225,29,72,0.4)]'
                        : 'text-gray-300 hover:text-white'}"
                    on:click={() => changeRange(opt)}
                >
                    {opt}d
                </button>
            {/each}
        </div>
    </div>

    {#if loading && !overview}
        <div class="flex justify-center items-center py-20">
            <div
                class="animate-spin rounded-full h-12 w-12 border-t-4 border-b-4 border-dracin-primary"
            ></div>
        </div>
    {:else if error}
        <div
            class="bg-red-500/10 border border-red-500/40 text-red-300 p-4 rounded-xl text-center"
        >
            {error}
        </div>
    {:else}
        <!-- ---- KPI CARDS ---- -->
        <div class="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 mb-8">
            <div class="bg-dracin-card border border-white/5 rounded-xl p-4">
                <p
                    class="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1"
                >
                    Total User
                </p>
                <p class="text-2xl md:text-3xl font-extrabold text-white">
                    {fmt(overview?.totalUsers)}
                </p>
                <p class="text-xs text-emerald-400 mt-1">
                    +{fmt(overview?.newUsersInRange)} dalam {days}d
                </p>
            </div>

            <div class="bg-dracin-card border border-white/5 rounded-xl p-4">
                <p
                    class="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1"
                >
                    DAU
                </p>
                <p class="text-2xl md:text-3xl font-extrabold text-white">
                    {fmt(overview?.dau)}
                </p>
                <p class="text-xs text-gray-500 mt-1">24 jam terakhir</p>
            </div>

            <div class="bg-dracin-card border border-white/5 rounded-xl p-4">
                <p
                    class="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1"
                >
                    Total Views
                </p>
                <p class="text-2xl md:text-3xl font-extrabold text-white">
                    {fmt(overview?.totalViews)}
                </p>
                <p class="text-xs text-rose-400 mt-1">
                    {fmt(overview?.viewsInRange)} dalam {days}d
                </p>
            </div>

            <div class="bg-dracin-card border border-white/5 rounded-xl p-4">
                <p
                    class="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1"
                >
                    Subscriber Aktif
                </p>
                <p class="text-2xl md:text-3xl font-extrabold text-white">
                    {fmt(overview?.activeSubscribers)}
                </p>
                <p class="text-xs text-gray-500 mt-1">
                    dari {fmt(overview?.totalUsers)} user
                </p>
            </div>

            <div class="bg-dracin-card border border-white/5 rounded-xl p-4">
                <p
                    class="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1"
                >
                    Konversi
                </p>
                <p class="text-2xl md:text-3xl font-extrabold text-white">
                    {overview?.conversionRate ?? 0}%
                </p>
                <p class="text-xs text-gray-500 mt-1">premium ratio</p>
            </div>

            <div class="bg-dracin-card border border-white/5 rounded-xl p-4">
                <p
                    class="text-xs uppercase tracking-wider text-gray-400 font-bold mb-1"
                >
                    Subscribe Baru
                </p>
                <p class="text-2xl md:text-3xl font-extrabold text-white">
                    {fmt(subscriptions?.recentSubscribes)}
                </p>
                <p class="text-xs text-gray-500 mt-1">dalam {days}d</p>
            </div>
        </div>

        <!-- ---- TREND CHART ---- -->
        <div
            class="bg-dracin-card border border-white/5 rounded-2xl p-6 mb-8 shadow-xl"
        >
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-bold text-white">Tren Harian</h2>
                <div class="text-xs text-gray-500">
                    DAU · Views · Registrasi
                </div>
            </div>
            <div class="w-full h-80">
                <canvas bind:this={trendCanvas}></canvas>
            </div>
        </div>

        <!-- ---- TWO-COLUMN: Event mix + Provider popularity ---- -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
            <div
                class="bg-dracin-card border border-white/5 rounded-2xl p-6 shadow-xl"
            >
                <h2 class="text-lg font-bold text-white mb-4">
                    Distribusi Aktivitas
                </h2>
                {#if eventBreakdown.length}
                    <div class="w-full h-72">
                        <canvas bind:this={eventsCanvas}></canvas>
                    </div>
                {:else}
                    <p class="text-gray-500 text-sm py-12 text-center">
                        Belum ada event tercatat di rentang ini.
                    </p>
                {/if}
            </div>

            <div
                class="bg-dracin-card border border-white/5 rounded-2xl p-6 shadow-xl"
            >
                <h2 class="text-lg font-bold text-white mb-4">
                    Provider Terpopuler
                </h2>
                {#if providerBreakdown.length}
                    <div class="w-full h-72">
                        <canvas bind:this={providerCanvas}></canvas>
                    </div>
                {:else}
                    <p class="text-gray-500 text-sm py-12 text-center">
                        Belum ada video_start tercatat di rentang ini.
                    </p>
                {/if}
            </div>
        </div>

        <!-- ---- TOP CONTENT TABLE ---- -->
        <div
            class="bg-dracin-card border border-white/5 rounded-2xl p-6 shadow-xl"
        >
            <div class="flex items-center justify-between mb-4">
                <h2 class="text-lg font-bold text-white">Konten Terpopuler</h2>
                <span class="text-xs text-gray-500">Top 10 dalam {days}d</span>
            </div>
            {#if topContent.length}
                <div class="overflow-x-auto">
                    <table class="w-full text-sm">
                        <thead>
                            <tr
                                class="text-left text-gray-400 uppercase tracking-wider text-xs border-b border-white/5"
                            >
                                <th class="py-2 pr-4 font-bold w-10">#</th>
                                <th class="py-2 pr-4 font-bold">Drama ID</th>
                                <th class="py-2 pr-4 font-bold">Provider</th>
                                <th class="py-2 pr-4 font-bold text-right"
                                    >Views</th
                                >
                            </tr>
                        </thead>
                        <tbody>
                            {#each topContent as item, i}
                                <tr
                                    class="border-b border-white/5 hover:bg-white/5 transition-colors"
                                >
                                    <td
                                        class="py-2 pr-4 text-gray-500 font-bold"
                                        >{i + 1}</td
                                    >
                                    <td
                                        class="py-2 pr-4 text-white font-mono text-xs"
                                        >{item.dramaId}</td
                                    >
                                    <td class="py-2 pr-4">
                                        <span
                                            class="text-xs px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-gray-300 uppercase tracking-wider"
                                        >
                                            {item.provider || "—"}
                                        </span>
                                    </td>
                                    <td
                                        class="py-2 pr-4 text-right text-white font-bold"
                                        >{fmt(item.views)}</td
                                    >
                                </tr>
                            {/each}
                        </tbody>
                    </table>
                </div>
            {:else}
                <p class="text-gray-500 text-sm py-12 text-center">
                    Belum ada data tontonan dalam rentang ini.
                </p>
            {/if}
        </div>
    {/if}
</div>
