require('dotenv').config();
const { Post } = require('./src/models');
const sequelize = require('./src/config/database');

async function checkPosts() {
    try {
        await sequelize.authenticate();
        console.log('Database connected.');

        const posts = await Post.findAll();
        console.log(`Total Posts: ${posts.length}`);

        posts.forEach(p => {
            console.log(`[${p.id}] Title: ${p.title} | Status: '${p.status}' | Slug: '${p.slug}'`);
        });

    } catch (error) {
        console.error('Error:', error);
    } finally {
        await sequelize.close();
    }
}

checkPosts();
