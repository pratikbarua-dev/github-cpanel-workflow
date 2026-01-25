require('dotenv').config();
const sequelize = require('./src/config/database');
const { Project, Post, TeamMember, Publication, User } = require('./src/models');
const bcrypt = require('bcryptjs');

const seedData = async (force = false) => {
    try {
        if (force) {
            await sequelize.sync({ force: true }); // Reset DB
            console.log('Database reset.');
        }

        // Admin User
        const hashedPassword = await bcrypt.hash('admin123', 10);
        await User.findOrCreate({
            where: { email: 'admin@morph.org' },
            defaults: {
                password: hashedPassword,
                role: 'admin'
            }
        });

        // Use findOrCreate or count to avoid duplicate seeding if not forcing
        const projectCount = await Project.count();
        if (projectCount === 0) {
            // Projects (Real Data)
            await Project.bulkCreate([
                {
                    title: 'Baseline Survey on Climate Adaptation',
                    slug: 'climate-adaptation-baseline',
                    status: 'Completed',
                    summary: 'Conducted baseline surveys on climate adaptation and local governance to understand community resilience.',
                    image_url: 'https://images.unsplash.com/photo-1470071459604-3b5ec3a7fe05?auto=format&fit=crop&w=800&q=80',
                    content: '<p>Conducted extensive baseline surveys on climate adaptation strategies and local governance structures in vulnerable regions.</p>'
                },
                {
                    title: 'Migration & Refugee Research',
                    slug: 'migration-research',
                    status: 'Ongoing',
                    summary: 'Partnered with universities for joint research on migration and refugee issues.',
                    image_url: 'https://images.unsplash.com/photo-1541829070764-84a7d30dd3f3?auto=format&fit=crop&w=800&q=80',
                    content: '<p>Collaboration with Mawlana Bhashani Science and Technology University and Daffodil International University to study migration patterns and refugee challenges.</p>'
                },
                {
                    title: 'Public Health Policy Briefs',
                    slug: 'public-health-policy',
                    status: 'Published',
                    summary: 'Developed policy briefs on local governance and public health challenges.',
                    image_url: 'https://images.unsplash.com/photo-1576091160550-21878bf71847?auto=format&fit=crop&w=800&q=80',
                    content: '<p>Analysis and policy recommendations addressing critical public health challenges at the local governance level.</p>'
                }
            ]);
            console.log('Projects seeded.');
        }

        const postCount = await Post.count();
        if (postCount === 0) {
            // Posts (News)
            await Post.bulkCreate([
                {
                    title: 'MoRPH Launches Public Health Initiative',
                    type: 'News',
                    date: '2024-01-15',
                    slug: 'launch-public-health-initiative',
                    status: 'published',
                    image_url: 'https://images.unsplash.com/photo-1506784983877-45594efa4cbe?auto=format&fit=crop&w=500&q=60'
                },
                {
                    title: 'Workshop on Disaster Risk Reduction',
                    type: 'Event',
                    date: '2024-03-20',
                    slug: 'workshop-drr',
                    status: 'published',
                    image_url: 'https://images.unsplash.com/photo-1531206715517-5c0ba140b2b8?auto=format&fit=crop&w=500&q=60'
                }
            ]);
            console.log('Posts seeded.');
        }

        const teamCount = await TeamMember.count();
        if (teamCount === 0) {
            // Team (Real Data)
            await TeamMember.bulkCreate([
                {
                    name: 'Dr. Md. Mahbubur Rahman',
                    role: 'Executive Director',
                    image_url: '/images/team/mahbubur.png',
                    bio: 'Former Senior Fellow in Residence at the Global Migration Centre, Geneva Graduate Institute, Switzerland. Recipient of the Swiss Government Excellence Scholarship for postdoctoral research in human rights. Expertise in migration, human rights, security, refugee protection, displacement, and gender issues. Previously with UNHCR, IOM, and WFP.'
                },
                {
                    name: 'Dr. Ahmed Hossain',
                    role: 'Director (Research and Education)',
                    image_url: '/images/team/ahmed.png',
                    bio: 'Ph.D. in Public Health, University of Toronto. Former Canadian Institute of Health Research Fellow. A leading scholar in statistical genomics and public health research on chronic and infectious diseases, with nearly 100 articles in top journals like The Lancet and JAMA.'
                },
                {
                    name: 'Dr. M M Taimur Hasan',
                    role: 'Director (Public Health)',
                    image_url: '/images/team/taimur.png',
                    bio: 'MBBS and MPH. Over 20 years of experience, including leading the public health team at UNHCR for Rohingya refugees in Bangladesh. Leads all public health–related programs and provides strategic technical guidance.'
                },
                {
                    name: 'Mr. Sajjadul Islam',
                    role: 'Director (Operations)',
                    image_url: '/images/team/sajjadul.png',
                    bio: 'MSc in Geography & MBA. 26 years of professional experience, including 14 years with UN Agencies (UNDP, WFP, UN Women) and GIZ. Expert in disaster management, policy development, and project management in DRR, CCA, and environmental sectors.'
                }
            ]);
            console.log('Team seeded.');
        }

        console.log('Seed check complete.');
        if (require.main === module) process.exit();
    } catch (error) {
        console.error('Error seeding data:', error);
        if (require.main === module) process.exit(1);
    }
};

if (require.main === module) {
    seedData(true); // Force wipe if run directly
}

module.exports = seedData;
