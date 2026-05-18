/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{svelte,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
      },
      colors: {
        dracin: {
          dark: '#0a0a0a', // Deepest black/grey
          card: '#121212', // Slightly lighter for cards
          cardHover: '#1a1a1a', // Hover state for cards
          primary: '#e11d48', // Vibrant Rose/Crimson
          secondary: '#8b5cf6', // Violet accent
          text: '#f8fafc',
          muted: '#94a3b8'
        }
      }
    },
  },
  plugins: [],
}
