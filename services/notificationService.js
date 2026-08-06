const nodemailer = require("nodemailer");

// Create standard transporter using Gmail SMTP service
const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * Sends a transactional email notification to a customer using Nodemailer.
 * Does not throw on errors to ensure routing execution is robust.
 * 
 * @param {string} customerEmail - Customer email address
 * @param {string} customerName - Customer name
 * @param {string} event - Notification event string ("request_received", "return_approved", "return_rejected", "exchange_confirmed")
 * @param {object} extraData - Additional dynamic parameters (e.g. rejectionReason, exchangeSize)
 */
const sendNotification = async (customerEmail, customerName, event, extraData = {}) => {
  try {
    let subject = "";
    let htmlContent = "";

    switch (event) {
      case "request_received":
        subject = "We've received your return request — Bean Identity";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #000; border-bottom: 2px solid #000; padding-bottom: 10px;">Hello ${customerName},</h2>
            <p>We have successfully received your return/exchange request.</p>
            <p>If the returned product passes our quality check parameters based on the photos and details submitted, the refund/exchange will be processed within <strong>5–6 business days</strong>.</p>
            <p>Thank you for choosing <strong>Bean Identity</strong>.</p>
            <hr style="border: 0; border-top: 1px solid #ccc; margin: 20px 0;" />
            <p style="font-size: 0.8em; color: #777; text-align: center;">This is an automated email from Bean Identity Support. Please do not reply directly.</p>
          </div>
        `;
        break;

      case "return_approved":
        subject = "Your return has been approved — Bean Identity";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #000; border-bottom: 2px solid #000; padding-bottom: 10px;">Hello ${customerName},</h2>
            <p>We are pleased to inform you that your return request has been <strong>approved</strong>.</p>
            <p>Your refund has been initiated and will reflect in your account within <strong>5–6 business days</strong> depending on your payment provider.</p>
            <p>Thank you for your patience and for choosing <strong>Bean Identity</strong>.</p>
            <hr style="border: 0; border-top: 1px solid #ccc; margin: 20px 0;" />
            <p style="font-size: 0.8em; color: #777; text-align: center;">This is an automated email from Bean Identity Support. Please do not reply directly.</p>
          </div>
        `;
        break;

      case "return_rejected":
        subject = "Update on your return request — Bean Identity";
        const rejectionReason = extraData.rejectionReason || "No specific reason provided.";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #000; border-bottom: 2px solid #000; padding-bottom: 10px;">Hello ${customerName},</h2>
            <p>We are writing to provide an update regarding your return/exchange request.</p>
            <p>Unfortunately, your request could not be approved at this time due to the following reason:</p>
            <blockquote style="background: #f9f9f9; border-left: 5px solid #ff4444; padding: 15px; margin: 20px 0; font-style: italic;">
              ${rejectionReason}
            </blockquote>
            <p>If you have any questions or wish to provide further details, please reach out to our team at support@beanidentity.com.</p>
            <hr style="border: 0; border-top: 1px solid #ccc; margin: 20px 0;" />
            <p style="font-size: 0.8em; color: #777; text-align: center;">This is an automated email from Bean Identity Support. Please do not reply directly.</p>
          </div>
        `;
        break;

      case "exchange_confirmed":
        subject = "Your exchange request is confirmed — Bean Identity";
        const exchangeSize = extraData.exchangeSize || "N/A";
        htmlContent = `
          <div style="font-family: Arial, sans-serif; line-height: 1.6; color: #333; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #eee;">
            <h2 style="color: #000; border-bottom: 2px solid #000; padding-bottom: 10px;">Hello ${customerName},</h2>
            <p>Great news! Your exchange request is <strong>confirmed</strong>.</p>
            <p>We are preparing your replacement order in size <strong>${exchangeSize}</strong>, which will be dispatched shortly.</p>
            <p>Thank you for choosing <strong>Bean Identity</strong>.</p>
            <hr style="border: 0; border-top: 1px solid #ccc; margin: 20px 0;" />
            <p style="font-size: 0.8em; color: #777; text-align: center;">This is an automated email from Bean Identity Support. Please do not reply directly.</p>
          </div>
        `;
        break;

      default:
        console.warn(`[NotificationService] Unrecognized notification event: "${event}"`);
        return false;
    }

    const mailOptions = {
      from: `"Bean Identity Support" <${process.env.EMAIL_USER || "noreply@beanidentity.com"}>`,
      to: customerEmail,
      subject: subject,
      html: htmlContent,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log(`[NotificationService] Email dispatched successfully for event "${event}". MessageId: ${info.messageId}`);
    return true;
  } catch (error) {
    console.error(`[NotificationService] Error sending email for event "${event}":`, error);
    // Prevent crashes: "Not throw — wrap in try/catch, errors should only log, not crash the server"
    return false;
  }
};

module.exports = sendNotification;
