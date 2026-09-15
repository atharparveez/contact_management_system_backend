// services/mailService.js
import nodemailer from "nodemailer";
import dotenv from "dotenv";
dotenv.config();

let transporter = null;

function getTransporter() {
  if (transporter) return transporter;
  if (!process.env.GMAIL_USER || !process.env.GMAIL_APP_PASSWORD) return null;

  transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });
  return transporter;
}

// Notifies the support inbox (SUPPORT_NOTIFY_EMAIL) about a new Contact Us
// submission. Never throws -- a failed/unconfigured mail send shouldn't stop
// the message from having already been saved to MongoDB.
export async function sendContactUsNotification({ fromEmail, message }) {
  const notifyTo = process.env.SUPPORT_NOTIFY_EMAIL;
  if (!notifyTo) {
    console.warn("⚠️ SUPPORT_NOTIFY_EMAIL not set -- skipping contact-us email notification.");
    return;
  }

  const mailer = getTransporter();
  if (!mailer) {
    console.warn("⚠️ GMAIL_USER/GMAIL_APP_PASSWORD not set -- skipping contact-us email notification.");
    return;
  }

  try {
    await mailer.sendMail({
      from: `"CMS Contact Us" <${process.env.GMAIL_USER}>`,
      to: notifyTo,
      replyTo: fromEmail,
      subject: `New Contact Us message from ${fromEmail}`,
      text: `From: ${fromEmail}\n\n${message}`,
    });
  } catch (error) {
    console.error("❌ Error sending contact-us email notification:", error);
  }
}
