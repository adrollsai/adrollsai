/* adrollsai/adrollsai/adrollsai-builder-app/tailwind.config.ts */
import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Use CSS variables for dynamic theming
        primary: "var(--primary)", 
        "primary-text": "var(--primary-text)", 
        accent: "#FFD8E4", 
        "accent-text": "#31111D", 
        surface: "var(--surface)", 
      },
      borderRadius: {
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem',
      }
    },
  },
  plugins: [],
};
export default config;