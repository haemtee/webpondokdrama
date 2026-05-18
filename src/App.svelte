<script>
    import { onMount } from 'svelte';
    import Router from 'svelte-spa-router';
    import { checkAuth } from './stores/auth.js';
    import Navbar from './components/Navbar.svelte';
    
    // Pages
    import Home from './pages/Home.svelte';
    import Login from './pages/Login.svelte';
    import Register from './pages/Register.svelte';
    import Dashboard from './pages/Dashboard.svelte';
    import Admin from './pages/Admin.svelte';
    import Watch from './pages/Watch.svelte';

    const routes = {
        '/': Home,
        '/login': Login,
        '/register': Register,
        '/dashboard': Dashboard,
        '/admin': Admin,
        '/watch/:provider/:drama_id/:episode_id': Watch,
    };

    onMount(() => {
        checkAuth();
    });
</script>

<Navbar />

<main class="container mx-auto p-4 pt-8">
    <Router {routes} />
</main>
