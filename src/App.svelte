<script>
    import { onMount } from "svelte";
    import Router from "svelte-spa-router";
    import { checkAuth, authReady } from "./stores/auth.js";
    import { trackPageView } from "./stores/analytics.js";
    import Navbar from "./components/Navbar.svelte";

    // Pages
    import Home from "./pages/Home.svelte";
    import Login from "./pages/Login.svelte";
    import Register from "./pages/Register.svelte";
    import Profile from "./pages/Profile.svelte";
    import Admin from "./pages/Admin.svelte";
    import Watch from "./pages/Watch.svelte";

    const routes = {
        "/": Home,
        "/login": Login,
        "/register": Register,
        "/profile": Profile,
        // Backward-compatible alias for old links
        "/dashboard": Profile,
        "/admin": Admin,
        "/watch/:provider/:drama_id/:episode_id": Watch,
    };

    // svelte-spa-router emits a `routeLoaded` event on the document body when
    // a route finishes mounting. We use that to fire `page_view` analytics.
    function handleRouteLoaded(e) {
        const path =
            e?.detail?.location ||
            (typeof location !== "undefined" ? location.hash : null);
        trackPageView(path);
    }

    onMount(() => {
        checkAuth();
        // Initial page view (the router fires routeLoaded too, but firing
        // here ensures we record the very first navigation even on cold start).
        trackPageView();
    });
</script>

<svelte:window on:hashchange={() => trackPageView()} />

<Navbar />

<main class="container mx-auto p-4 pt-8">
    {#if $authReady}
        <Router {routes} on:routeLoaded={handleRouteLoaded} />
    {:else}
        <!-- Wait for the auth probe to finish before rendering any route, so
             that pages relying on $isAuthenticated don't bounce to /login on
             first paint. -->
        <div class="flex justify-center items-center min-h-[60vh]">
            <div
                class="animate-spin rounded-full h-10 w-10 border-t-4 border-b-4 border-dracin-primary"
            ></div>
        </div>
    {/if}
</main>
