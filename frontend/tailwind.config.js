/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        meetime: {
          50:  '#f0f4ff',
          100: '#e0eaff',
          500: '#3b5bdb',
          600: '#2f4ac7',
          700: '#2540b0',
        },
      },
    },
  },
  plugins: [],
};
