/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./static/index.html",
    "./static/js/app.js",
  ],
  theme: {
    extend: {
      fontFamily: {
        'space': ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      }
    },
  },
  plugins: [],
}