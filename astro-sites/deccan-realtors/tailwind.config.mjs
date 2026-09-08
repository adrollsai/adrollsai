/** @type {import('tailwindcss').Config} */
export default {
  content: ['./src/**/*.{astro,html,js,jsx,md,mdx,svelte,ts,tsx,vue}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Plus Jakarta Sans"', '-apple-system', 'sans-serif'],
        display: ['Outfit', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#F0F4FA',
          100: '#E1E9F5',
          200: '#C3D3EC',
          500: '#1E3A8A',
          800: '#0F1E4A',
          900: '#0A1433',
          950: '#050A1A',
        },
        accent: {
          400: '#E2C275',
          500: '#C1995E',
          600: '#AD8246',
        }
      }
    },
  },
  plugins: [],
};
