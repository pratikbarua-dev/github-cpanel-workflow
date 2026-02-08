const Sequelize = require('sequelize');
const sequelize = require('../config/database');

const User = sequelize.define('user', {
    email: {
        type: Sequelize.STRING,
        allowNull: false,
        unique: true
    },
    password: {
        type: Sequelize.STRING,
        allowNull: false
    },
    role: {
        type: Sequelize.STRING,
        defaultValue: 'admin' // 'admin', 'moderator'
    },
    permissions: {
        type: Sequelize.JSON, // Stores array e.g. ['manage_posts', 'manage_projects']
        defaultValue: []
    },
    is_active: {
        type: Sequelize.BOOLEAN,
        defaultValue: true
    }
});

const Project = sequelize.define('project', {
    title: {
        type: Sequelize.STRING,
        allowNull: false
    },
    slug: {
        type: Sequelize.STRING,
        unique: true
    },
    status: {
        type: Sequelize.ENUM('Ongoing', 'Completed', 'Archived'),
        defaultValue: 'Ongoing'
    },
    summary: {
        type: Sequelize.TEXT
    },
    content: {
        type: Sequelize.TEXT('long')
    },
    content_bn: {
        type: Sequelize.TEXT('long')
    },
    image_url: {
        type: Sequelize.STRING
    }
});

const Publication = sequelize.define('publication', {
    title: {
        type: Sequelize.STRING,
        allowNull: false
    },
    category: {
        type: Sequelize.STRING
    },
    description: {
        type: Sequelize.TEXT('long')
    },
    published_date: {
        type: Sequelize.DATEONLY
    },
    file_url: {
        type: Sequelize.STRING
    },
    is_archived: {
        type: Sequelize.BOOLEAN,
        defaultValue: false
    },
    image_url: {
        type: Sequelize.STRING
    },
    heading_image: {
        type: Sequelize.TEXT('long') // Can store base64 or URL
    }
});

const TeamMember = sequelize.define('team_member', {
    name: {
        type: Sequelize.STRING,
        allowNull: false
    },
    role: {
        type: Sequelize.STRING
    },
    bio: {
        type: Sequelize.TEXT('long')
    },
    image_url: {
        type: Sequelize.STRING
    },
    education: {
        type: Sequelize.TEXT('long')
    },
    display_order: {
        type: Sequelize.INTEGER,
        defaultValue: 0
    }
});

const Post = sequelize.define('post', {
    type: {
        type: Sequelize.ENUM('News', 'Event', 'Article', 'Training', 'CSR'),
        defaultValue: 'News'
    },
    sub_type: {
        type: Sequelize.STRING,
        allowNull: true
    },
    title: {
        type: Sequelize.STRING,
        allowNull: false
    },
    slug: {
        type: Sequelize.STRING,
        unique: true
    },
    date: {
        type: Sequelize.DATEONLY
    },
    content: {
        type: Sequelize.TEXT('long') // Ensure it can hold large HTML
    },
    content_bn: {
        type: Sequelize.TEXT('long')
    },
    excerpt: {
        type: Sequelize.TEXT
    },
    status: {
        type: Sequelize.ENUM('draft', 'published', 'archived'),
        defaultValue: 'draft'
    },
    image_url: {
        type: Sequelize.STRING
    }
});

const FormSubmission = sequelize.define('form_submission', {
    type: {
        type: Sequelize.STRING, // Contact, Partner, Volunteer
        defaultValue: 'Contact'
    },
    name: {
        type: Sequelize.STRING
    },
    email: {
        type: Sequelize.STRING
    },
    subject: {
        type: Sequelize.STRING
    },
    message: {
        type: Sequelize.TEXT
    },
    status: {
        type: Sequelize.ENUM('New', 'Read', 'Replied'),
        defaultValue: 'New'
    },
    file_url: {
        type: Sequelize.STRING
    }
});

const CustomForm = sequelize.define('custom_form', {
    title: { type: Sequelize.STRING, allowNull: false },
    slug: { type: Sequelize.STRING, unique: true },
    description: { type: Sequelize.TEXT },
    status: {
        type: Sequelize.ENUM('Active', 'Inactive'),
        defaultValue: 'Active'
    }
});

const FormField = sequelize.define('form_field', {
    label: { type: Sequelize.STRING, allowNull: false },
    name: { type: Sequelize.STRING, allowNull: false }, // internal id like 'first_name'
    type: {
        type: Sequelize.ENUM('text', 'email', 'textarea', 'select', 'checkbox', 'number'),
        allowNull: false
    },
    options: { type: Sequelize.TEXT }, // JSON string for select options
    required: { type: Sequelize.BOOLEAN, defaultValue: false },
    order: { type: Sequelize.INTEGER, defaultValue: 0 }
});

const FormResponse = sequelize.define('form_response', {
    data: { type: Sequelize.TEXT('long') }, // JSON string of submission
    ip_address: { type: Sequelize.STRING }
});

const Comment = sequelize.define('comment', {
    content: {
        type: Sequelize.TEXT,
        allowNull: false
    },
    status: {
        type: Sequelize.ENUM('pending', 'approved', 'rejected'),
        defaultValue: 'pending'
    },
    author_name: {
        type: Sequelize.STRING,
        defaultValue: 'Guest'
    }
});

const Like = sequelize.define('like', {
    ip_address: {
        type: Sequelize.STRING
    }
});

const GlobalSetting = sequelize.define('global_setting', {
    key: {
        type: Sequelize.STRING,
        unique: true,
        allowNull: false
    },
    value: {
        type: Sequelize.TEXT // JSON string for arrays/objects
    }
});

// Associations
CustomForm.hasMany(FormField, { onDelete: 'CASCADE' });
FormField.belongsTo(CustomForm);

CustomForm.hasMany(FormResponse, { onDelete: 'CASCADE' });
FormResponse.belongsTo(CustomForm);

// Polymorphic Associations for Comments and Likes
// We will manually handle the "type" (Project vs Post) or simply relate them optionally to both given simplicity
// For simplicity in this stack, let's add direct associations.
Project.hasMany(Comment);
Comment.belongsTo(Project);

Post.hasMany(Comment);
Comment.belongsTo(Post);

Project.hasMany(Like);
Like.belongsTo(Project);

Post.hasMany(Like);
Like.belongsTo(Post);

module.exports = {
    User,
    Project,
    Publication,
    TeamMember,
    Post,
    FormSubmission,
    CustomForm,
    FormField,
    FormResponse,
    Comment,
    Like,
    GlobalSetting
};
