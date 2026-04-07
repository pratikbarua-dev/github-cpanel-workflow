const { Resend } = require('resend');

// Initialize Resend safely
let resend;
try {
    // GLOBAL KILL SWITCH: Disable this to allow emails
    const DISABLE_ALL_EMAILS = false;

    if (DISABLE_ALL_EMAILS) {
        console.warn('CRITICAL: All email systems have been SHUT DOWN by global kill switch.');
    } else if (process.env.RESEND_API_KEY) {
        resend = new Resend(process.env.RESEND_API_KEY);
    } else {
        console.warn('WARNING: RESEND_API_KEY is missing. Email service will not work.');
    }
} catch (error) {
    console.error('Error initializing Resend:', error);
}

const getAutoReplyTemplate = (name, content) => {
    // Brand Colors
    const primaryColor = '#0e8c96';
    const secondaryColor = '#2c3e50';
    const footerColor = '#0b5063';

    // Ensure Base URL is correct for images (Render URL or fallback)
    const baseUrl = process.env.BASE_URL || 'https://morphbangladesh.org';
    const logoUrl = `${baseUrl}/images/logo.jpg`;

    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>MoRPH Notification</title>
        <style>
            body { font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f4f6f8; }
            .container { max-width: 640px; margin: 40px auto; background: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 15px rgba(0,0,0,0.05); border: 1px solid #e1e4e8; }
            .header { background-color: #ffffff; padding: 30px 40px; text-align: center; border-bottom: 3px solid ${primaryColor}; }
            .header img { height: 60px; width: auto; display: inline-block; }
            .header h1 { color: ${primaryColor}; margin: 15px 0 0; font-size: 24px; font-weight: 700; letter-spacing: 0.5px; }
            .content { padding: 40px 40px; background-color: #ffffff; }
            .content p { margin: 0 0 15px; font-size: 16px; color: ${secondaryColor}; }
            .content h3 { color: ${primaryColor}; margin-top: 0; }
            .footer { background-color: ${footerColor}; padding: 30px; text-align: center; font-size: 13px; color: rgba(255,255,255,0.8); }
            .footer a { color: #ffffff; text-decoration: underline; }
            .button { display: inline-block; padding: 12px 28px; background-color: ${primaryColor}; color: white !important; text-decoration: none; border-radius: 6px; font-weight: bold; margin-top: 20px; box-shadow: 0 2px 5px rgba(14, 140, 150, 0.3); }
            /* Table Styling for Admin Notifications */
            table { width: 100%; border-collapse: collapse; margin-top: 10px; }
            td { padding: 12px 0; border-bottom: 1px solid #eee; vertical-align: top; }
            td:first-child { color: ${primaryColor}; font-weight: 600; width: 35%; padding-right: 15px; }
            td:last-child { color: ${secondaryColor}; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <!-- Use Alt text if image fails to load, but try to load from live URL -->
                <img src="${logoUrl}" alt="MoRPH Logo">
                <!-- Fallback Title if Image Breaks (optional, but image usually works if public) -->
            </div>
            <div class="content">
                <p><strong>Dear ${name},</strong></p>
                ${content}
                
                <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #f0f0f0;">
                    <p style="font-size: 14px; margin-bottom: 0;">Best regards,</p>
                    <p style="font-weight: bold; color: ${primaryColor}; margin-top: 5px;">The MoRPH Team</p>
                    <p style="font-size: 12px; font-style: italic; color: #999;">Moulovibari Research and Partnership Hub</p>
                    <p style="font-size: 11px; color: #999; margin-top: 15px; border-top: 1px dashed #eee; padding-top: 10px;">This in an automated mail , do not reply</p>
                </div>
            </div>
            <div class="footer">
                <p>&copy; ${new Date().getFullYear()} MoRPH. All rights reserved.</p>
                <p style="margin: 10px 0;">Head Office: Holding No 6034, Village: Panchtikry, Tangail<br>
                Liaison Office: SEL Centre (6th Floor), 29 West Panthapath, Dhaka-1205</p>
                <p><a href="${baseUrl}">Visit our Website</a></p>
            </div>
        </div>
    </body>
    </html>
    `;
};

exports.sendEmail = async (to, subject, html, attachments = []) => {
    if (!resend) {
        console.warn('[EmailSystem] Email blocked: System is currently SHUT DOWN.');
        return;
    }

    // Get from address from env or use default
    const fromAddress = process.env.EMAIL_FROM || 'MoRPH <info@morphbangladesh.org>';

    console.log(`Attempting to send email via Resend to: ${to}`);
    try {
        const mailOptions = {
            from: fromAddress,
            to: [to],
            subject: subject,
            html: html
        };

        if (attachments && attachments.length > 0) {
            mailOptions.attachments = attachments;
        }

        const { data, error } = await resend.emails.send(mailOptions);

        if (error) {
            console.error('Resend API Error:', error);
            throw new Error(error.message);
        }

        console.log(`Email sent successfully via Resend. ID: ${data.id}`);
    } catch (error) {
        console.error(`Failed to send email to ${to}:`, error);
        throw error;
    }
};

exports.sendAutoReply = async (to, name, subject, messageContent) => {
    const html = getAutoReplyTemplate(name, messageContent);
    await exports.sendEmail(to, subject, html);
};

exports.sendWelcomeEmail = async (to, role, password, permissions = []) => {
    const loginUrl = `${process.env.BASE_URL || 'https://morphbangladesh.org'}/admin/login`;

    let permissionsList = 'None';
    if (permissions && permissions.length > 0) {
        permissionsList = permissions.map(p => `<span style="background-color: #e2e8f0; color: #475569; padding: 2px 6px; border-radius: 4px; font-size: 12px; margin-right: 4px; display: inline-block; margin-bottom: 4px;">${p}</span>`).join('');
    }

    const messageContent = `
        <p>You have been added as a <strong>${role.charAt(0).toUpperCase() + role.slice(1)}</strong> to the MoRPH Admin Panel.</p>
        <p>Please find your temporary login credentials below:</p>
        
        <div style="background-color: #f0fdf4; border-left: 4px solid #0e8c96; padding: 15px; margin: 20px 0; border-radius: 4px;">
            <p style="margin: 0; font-size: 14px; color: #555;">Email:</p>
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #333;">${to}</p>
            
            <p style="margin: 0; font-size: 14px; color: #555;">Password:</p>
            <p style="margin: 0 0 10px 0; font-weight: bold; color: #333;">${password}</p>

            <p style="margin: 0; font-size: 14px; color: #555;">Permissions:</p>
            <div style="margin-top: 4px;">${permissionsList}</div>
        </div>

        <p>For security reasons, we strongly recommend that you change your password immediately after your first login via the Settings page.</p>

        <a href="${loginUrl}" class="button" style="color: white; text-decoration: none;">Login to Dashboard</a>
    `;

    const html = getAutoReplyTemplate('New Team Member', messageContent);
    await exports.sendEmail(to, 'Welcome to MoRPH Admin Panel', html);
};

exports.sendAccountDeletedEmail = async (to) => {
    const messageContent = `
        <p>Your account access to the MoRPH Admin Panel has been revoked by an administrator.</p>
        <p>If you believe this is an error, please contact the administration team.</p>
        <p>Thank you for your contributions.</p>
    `;

    const html = getAutoReplyTemplate('Account Deactivated', messageContent);
    await exports.sendEmail(to, 'Account Access Revoked', html);
};
