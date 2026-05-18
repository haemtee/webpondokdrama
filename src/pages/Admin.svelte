<script>
    import { onMount } from 'svelte';
    import { isAuthenticated, user } from '../stores/auth.js';
    import { push } from 'svelte-spa-router';
    import Chart from 'chart.js/auto';

    let stats = null;
    let loading = true;
    let chartCanvas;
    let error = '';

    onMount(async () => {
        if (!$isAuthenticated || $user?.role !== 'admin') {
            push('/');
            return;
        }

        try {
            const res = await fetch('/api/admin/analytics/overview');
            if (res.ok) {
                stats = await res.json();
                renderChart(stats.chartData);
            } else {
                error = 'Failed to load analytics. You might not have admin privileges.';
            }
        } catch (e) {
            error = 'Network error fetching analytics.';
        } finally {
            loading = false;
        }
    });

    function renderChart(chartData) {
        if (!chartCanvas) return;
        new Chart(chartCanvas, {
            type: 'line',
            data: {
                labels: chartData.labels,
                datasets: [{
                    label: 'Daily Active Users',
                    data: chartData.data,
                    borderColor: '#e11d48',
                    backgroundColor: 'rgba(225, 29, 72, 0.2)',
                    borderWidth: 2,
                    fill: true,
                    tension: 0.4
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        labels: { color: '#f8fafc' }
                    }
                },
                scales: {
                    x: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } },
                    y: { ticks: { color: '#94a3b8' }, grid: { color: '#334155' } }
                }
            }
        });
    }
</script>

<div class="max-w-6xl mx-auto">
    <div class="mb-8">
        <h1 class="text-3xl font-bold text-dracin-text mb-2">Admin Dashboard</h1>
        <p class="text-dracin-muted">Overview of platform analytics and user engagement.</p>
    </div>

    {#if loading}
        <div class="text-center text-gray-500 py-10">Loading analytics...</div>
    {:else if error}
        <div class="bg-red-500/20 border border-red-500 text-red-300 p-4 rounded text-center">
            {error}
        </div>
    {:else}
        <div class="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
            <div class="bg-dracin-card p-6 rounded-xl border border-gray-800 flex items-center justify-between">
                <div>
                    <p class="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Users</p>
                    <h2 class="text-4xl font-black text-white mt-1">{stats.totalUsers}</h2>
                </div>
                <div class="bg-blue-500/20 text-blue-400 p-3 rounded-full">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z"></path></svg>
                </div>
            </div>
            
            <div class="bg-dracin-card p-6 rounded-xl border border-gray-800 flex items-center justify-between">
                <div>
                    <p class="text-gray-400 text-sm font-bold uppercase tracking-wider">Total Views</p>
                    <h2 class="text-4xl font-black text-white mt-1">{stats.totalViews}</h2>
                </div>
                <div class="bg-dracin-primary/20 text-dracin-primary p-3 rounded-full">
                    <svg class="w-8 h-8" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"></path><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z"></path></svg>
                </div>
            </div>
        </div>

        <div class="bg-dracin-card p-6 rounded-xl border border-gray-800">
            <h3 class="font-bold text-lg mb-4">Engagement Overview</h3>
            <div class="w-full h-80">
                <canvas bind:this={chartCanvas}></canvas>
            </div>
        </div>
    {/if}
</div>
