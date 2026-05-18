<script>
    import { user, isAuthenticated, logout } from "../stores/auth.js";
    import { lang } from "../stores/lang.js";
    import { push } from "svelte-spa-router";

    function handleLogout() {
        logout();
        push("/login");
    }

    function toggleLang() {
        $lang = $lang === "id" ? "en" : "id";
    }
</script>

<nav
    class="bg-dracin-dark/80 backdrop-blur-md border-b border-white/5 p-4 sticky top-0 z-50 transition-all"
>
    <div class="container mx-auto flex justify-between items-center">
        <div class="flex items-center gap-8">
            <a
                href="#/"
                class="text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-dracin-primary to-dracin-secondary tracking-tight"
                >Dracinema</a
            >

            <div class="hidden md:flex gap-6 font-medium text-sm text-gray-300">
                <a href="#/" class="hover:text-white transition-colors"
                    >Beranda</a
                >
                <a href="#/" class="hover:text-white transition-colors"
                    >Trending</a
                >
                {#if $isAuthenticated}
                    <a
                        href="#/profile"
                        class="hover:text-white transition-colors"
                        >Lanjutkan Tonton</a
                    >
                    <a
                        href="#/profile"
                        class="hover:text-white transition-colors"
                        >Daftar Saya</a
                    >
                {/if}
            </div>
        </div>

        <div class="flex gap-4 items-center">
            <button
                on:click={toggleLang}
                class="flex items-center justify-center w-8 h-8 rounded-full bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-bold transition-colors"
                title="Toggle Language"
            >
                {$lang.toUpperCase()}
            </button>
            {#if $isAuthenticated}
                {#if $user?.role === "admin"}
                    <a
                        href="#/admin"
                        class="text-sm font-medium hover:text-dracin-primary transition-colors hidden sm:block"
                        >Admin</a
                    >
                {/if}
                <div class="group relative">
                    <button
                        class="flex items-center gap-2 hover:opacity-80 transition-opacity"
                    >
                        <div
                            class="w-8 h-8 rounded-full bg-gradient-to-tr from-dracin-primary to-dracin-secondary flex items-center justify-center text-white font-bold text-sm"
                        >
                            {$user?.email ? $user.email[0].toUpperCase() : "U"}
                        </div>
                    </button>
                    <!-- Dropdown -->
                    <div
                        class="absolute right-0 mt-2 w-48 bg-dracin-card border border-white/10 rounded-lg shadow-xl opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 transform origin-top-right"
                    >
                        <div class="p-2 flex flex-col">
                            <a
                                href="#/profile"
                                class="px-4 py-2 text-sm text-gray-300 hover:text-white hover:bg-white/5 rounded transition-colors"
                                >{$lang === "id" ? "Profil" : "Profile"}</a
                            >
                            <button
                                on:click={handleLogout}
                                class="text-left px-4 py-2 text-sm text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded transition-colors w-full"
                                >Logout</button
                            >
                        </div>
                    </div>
                </div>
            {:else}
                <a
                    href="#/login"
                    class="text-sm font-medium hover:text-white text-gray-300 transition-colors"
                    >Login</a
                >
                <a
                    href="#/register"
                    class="bg-dracin-primary hover:bg-rose-600 text-sm font-medium px-5 py-2 rounded-full transition-all text-white shadow-[0_0_15px_rgba(225,29,72,0.3)] hover:shadow-[0_0_20px_rgba(225,29,72,0.5)]"
                    >VIP</a
                >
            {/if}
        </div>
    </div>
</nav>
