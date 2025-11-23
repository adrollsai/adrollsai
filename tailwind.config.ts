import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Here is where we define your "Material 3" Palette
      colors: {
        primary: "#D0E8FF", // Light Blue (Google style container)
        "primary-text": "#001D35", // Dark Blue text
        accent: "#FFD8E4", // Light Coral
        "accent-text": "#31111D", // Dark Red/Brown text
        surface: "#F8F9FF", // Very light blue/white background
      },
      borderRadius: {
        // This enforces the "Bubbly" look
        'xl': '1rem',
        '2xl': '1.5rem',
        '3xl': '2rem', // Very round
      }
    },
  },
  plugins: [],
};
export default config;