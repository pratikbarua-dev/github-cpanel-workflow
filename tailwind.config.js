/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./views/**/*.{html,ejs,js}"],
    theme: {
        extend: {
            colors: {
                primary: '#0e8c96',
                'primary-light': '#20b2aa',
                secondary: '#2c3e50',
                footer: '#0b5063',
            },
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            }
        },
    },
    plugins: [],
}
