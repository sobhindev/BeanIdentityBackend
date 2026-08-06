const axios = require("axios");

const KLAVIYO_API_URL = "https://a.klaviyo.com/api";

/**
 * Tracks a custom event in Klaviyo using their v3 Events API.
 * 
 * @param {string} email - Customer email
 * @param {string} name - Customer name/first name
 * @param {string} eventName - Metric name (e.g. "Started Quiz", "Completed Quiz")
 * @param {object} properties - Custom properties associated with the event
 */
const trackEvent = async (email, name, eventName, properties = {}) => {
  const apiKey = process.env.KLAVIYO_PRIVATE_API_KEY;

  if (!apiKey) {
    console.warn("[KlaviyoService] Private API key is missing. Event tracking skipped.");
    return false;
  }

  if (!email || !email.trim()) {
    console.warn("[KlaviyoService] Email is missing. Event tracking skipped.");
    return false;
  }

  try {
    const payload = {
      data: {
        type: "event",
        attributes: {
          properties: properties,
          time: new Date().toISOString(),
          metric: {
            data: {
              type: "metric",
              attributes: {
                name: eventName
              }
            }
          },
          profile: {
            data: {
              type: "profile",
              attributes: {
                email: email.trim().toLowerCase(),
                first_name: name && name.trim() ? name.trim() : email.split("@")[0]
              }
            }
          }
        }
      }
    };

    const response = await axios.post(`${KLAVIYO_API_URL}/events/`, payload, {
      headers: {
        "Authorization": `Klaviyo-API-Key ${apiKey}`,
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json",
        "revision": "2024-10-15"
      }
    });

    console.log(`[KlaviyoService] Successfully tracked event "${eventName}" for ${email}. Status: ${response.status}`);
    return true;
  } catch (error) {
    const errorData = error.response ? error.response.data : null;
    console.error(`[KlaviyoService] Error tracking event "${eventName}" for ${email}:`,
      errorData ? JSON.stringify(errorData) : error.message
    );
    return false;
  }
};

module.exports = { trackEvent };
