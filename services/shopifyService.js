const axios = require("axios");
const { getShopifyToken } = require("../utils/shopifyAuth");

/**
 * Creates a customer in Shopify if they don't exist, or updates their tags.
 * @param {string} email - Customer email
 * @param {string} name - Customer name (first and last name)
 * @param {string[]} tagsToAppend - Array of tags to append to the customer (e.g. ['Quiz', 'Quiz-Completed'])
 */
async function createOrUpdateCustomer(email, name, tagsToAppend = []) {
  if (!email || !email.trim()) {
    console.warn("[ShopifyService] Email is missing. Skipping customer sync.");
    return null;
  }

  const shop = process.env.SHOPIFY_SHOP || "beanspot-2";
  const normalizedEmail = email.trim().toLowerCase();

  try {
    const token = await getShopifyToken();
    
    // 1. Parse name into first and last name
    const nameParts = (name || "").trim().split(/\s+/);
    const firstName = nameParts[0] || "";
    const lastName = nameParts.slice(1).join(" ") || "";

    // 2. Search for existing customer by email
    const searchUrl = `https://${shop}.myshopify.com/admin/api/2024-01/customers/search.json?query=email:${encodeURIComponent(normalizedEmail)}`;
    const searchResponse = await axios.get(searchUrl, {
      headers: {
        "X-Shopify-Access-Token": token,
        "Accept": "application/json"
      }
    });

    const customers = searchResponse.data.customers || [];

    if (customers.length > 0) {
      // Customer already exists, update their tags to include the new tags
      const existingCustomer = customers[0];
      const currentTags = existingCustomer.tags ? existingCustomer.tags.split(",").map(t => t.trim()) : [];
      
      let tagsUpdated = false;
      tagsToAppend.forEach(tag => {
        if (!currentTags.includes(tag)) {
          currentTags.push(tag);
          tagsUpdated = true;
        }
      });

      if (tagsUpdated) {
        const updateUrl = `https://${shop}.myshopify.com/admin/api/2024-01/customers/${existingCustomer.id}.json`;
        const updateResponse = await axios.put(updateUrl, {
          customer: {
            id: existingCustomer.id,
            tags: currentTags.join(", ")
          }
        }, {
          headers: {
            "X-Shopify-Access-Token": token,
            "Content-Type": "application/json",
            "Accept": "application/json"
          }
        });
        console.log(`[ShopifyService] Updated existing customer tags for ${normalizedEmail}. Tags: ${currentTags.join(", ")}`);
        return updateResponse.data.customer;
      } else {
        console.log(`[ShopifyService] Customer ${normalizedEmail} already exists and has all requested tags.`);
        return existingCustomer;
      }
    } else {
      // Customer does not exist, create a new one
      const createUrl = `https://${shop}.myshopify.com/admin/api/2024-01/customers.json`;
      const createResponse = await axios.post(createUrl, {
        customer: {
          first_name: firstName || normalizedEmail.split("@")[0],
          last_name: lastName || "",
          email: normalizedEmail,
          verified_email: true,
          accepts_marketing: true,
          marketing_opt_in_level: "single_opt_in",
          tags: tagsToAppend.join(", ")
        }
      }, {
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
          "Accept": "application/json"
        }
      });
      console.log(`[ShopifyService] Created new customer in Shopify for ${normalizedEmail}. Tags: ${tagsToAppend.join(", ")}`);
      return createResponse.data.customer;
    }
  } catch (error) {
    const errorData = error.response ? error.response.data : null;
    console.error(`[ShopifyService] Error creating/updating customer ${normalizedEmail}:`, 
      errorData ? JSON.stringify(errorData) : error.message
    );
    return null;
  }
}

module.exports = {
  createOrUpdateCustomer
};
