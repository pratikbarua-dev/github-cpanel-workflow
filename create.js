require('dotenv').config();
const nodemailer = require("nodemailer");

async function sendInvite() {
  console.log("Connecting to Brevo...");

  // 1. Setup the Connection (Using details from your image)
  const transporter = nodemailer.createTransport({
    host: "smtp-relay.brevo.com",
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER, // The 'a0bf...' email from your screenshot
      pass: process.env.SMTP_PASS, // The key you generated
    },
  });

  // 2. Define the Email
  const mailOptions = {
    from: '"Pathshala Admin" <no-reply@pathshala.com>', // You can customize this name!
    to: "pratikbarua52@gmail.com", // CHANGE THIS to your real email to test
    subject: "Welcome to Pathshala",
    html: `
      <div style="font-family: Arial, sans-serif; padding: 20px;">
        <h2 style="color: #3370ff;">Welcome to Pathshala!</h2>
        <p>You have been invited to join our platform.</p>
        <p>Click below to setup your account:</p>
        <a href="https://pathshala.com/register" style="background: #3370ff; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px;">Join Now</a>
      </div>
    `,
  };

  // 3. Send it
  try {
    const info = await transporter.sendMail(mailOptions);
    console.log("✅ Success! Email sent.");
    console.log("Message ID:", info.messageId);
  } catch (error) {
    console.error("❌ Error:", error);
  }
}

sendInvite();