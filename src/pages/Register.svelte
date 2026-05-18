<script>
    import { push } from 'svelte-spa-router';

    let email = '';
    let password = '';
    let error = '';
    let loading = false;

    async function handleRegister() {
        loading = true;
        error = '';
        try {
            const res = await fetch('/api/auth/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, password })
            });
            const data = await res.json();
            
            if (res.ok) {
                // Redirect to login after successful registration
                push('/login');
            } else {
                error = data.error || 'Registration failed';
            }
        } catch (e) {
            error = 'Network error';
        } finally {
            loading = false;
        }
    }
</script>

<div class="max-w-md mx-auto mt-20 bg-dracin-card p-8 rounded-2xl shadow-xl border border-gray-800">
    <h2 class="text-3xl font-bold mb-6 text-center text-dracin-primary">Create Account</h2>
    
    {#if error}
        <div class="bg-red-500/20 border border-red-500 text-red-300 p-3 rounded mb-4 text-sm">
            {error}
        </div>
    {/if}

    <form on:submit|preventDefault={handleRegister} class="flex flex-col gap-4">
        <div>
            <label class="block text-sm text-gray-400 mb-1">Email</label>
            <input type="email" bind:value={email} required class="w-full bg-gray-900 border border-gray-700 rounded p-3 focus:border-dracin-primary outline-none transition-colors" placeholder="you@example.com">
        </div>
        
        <div>
            <label class="block text-sm text-gray-400 mb-1">Password</label>
            <input type="password" bind:value={password} required class="w-full bg-gray-900 border border-gray-700 rounded p-3 focus:border-dracin-primary outline-none transition-colors" placeholder="••••••••">
        </div>
        
        <button type="submit" disabled={loading} class="w-full bg-dracin-primary hover:bg-rose-700 text-white font-bold py-3 rounded mt-4 transition-colors disabled:opacity-50">
            {loading ? 'Creating account...' : 'Register'}
        </button>
    </form>
    
    <p class="mt-6 text-center text-sm text-gray-400">
        Already have an account? <a href="#/login" class="text-dracin-primary hover:underline">Login here</a>
    </p>
</div>
