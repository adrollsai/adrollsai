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
        primary: {
          50: '#FDFBF7',
          100: '#FAF3E3',
          200: '#F4E5BE',
          300: '#EBD292',
          400: '#E2BF67',
          500: '#D4AF37', // Pure luxury vibrant gold
          600: '#C59E2B', // Radiant metallic gold
          700: '#A9841C',
          800: '#846612',
          900: '#56420A',
        },
        gold: {
          light: '#F5E6BE',
          DEFAULT: '#D4AF37',
          dark: '#AA8222',
          metallic: '#C5A059',
        },
        dark: {
          950: '#0B0F19',
          900: '#0F172A',
          850: '#1E293B',
          800: '#334155',
        }
      }
    },
  },
  plugins: [],
};
