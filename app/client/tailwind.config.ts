import type { Config } from 'tailwindcss';
import tailwindcssAnimate from 'tailwindcss-animate';

const config: Config = {
  // Light-only app. `media` would let `dark:` utilities fire off the OS setting
  // and override the brand tokens — see the @custom-variant note in src/index.css.
  darkMode: ['class'],
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  plugins: [tailwindcssAnimate],
};

export default config;
