/** @type {import('tailwindcss').Config} */
module.exports = {
    content: ["./views/**/*.{html,ejs,js}"],
    theme: {
        extend: {
            colors: {
                primary: '#097079',
                'primary-light': '#159c94',
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
