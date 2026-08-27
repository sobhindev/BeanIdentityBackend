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

/**
 * Looks up a Shopify order by its order number (e.g. "1023" or "#1023") and verifies
 * that the supplied email matches the order's contact email. Used by the returns/exchange
 * flow so customers can't submit a return against an order that isn't theirs, and so the
 * 5-day return window is measured against Shopify's own fulfillment date instead of a
 * hand-typed delivery date.
 *
 * Requires the custom app to have the `read_orders` scope, and (on stores where Shopify's
 * protected customer data approval applies) approval to access customer email/name via the
 * Admin API — see Shopify Admin > Settings > Apps > [your app] > API access.
 *
 * @param {string|number} orderNumber - Order number as entered by the customer.
 * @param {string} email - Email the customer entered, checked against the order's email.
 * @returns {Promise<null|{mismatch:true}|object>} null when no order is found, {mismatch:true}
 *   when the order exists but the email doesn't match, otherwise the resolved order details.
 */
async function findOrderByNameAndEmail(orderNumber, email) {
  const shop = process.env.SHOPIFY_SHOP || "beanspot-2";
  const token = await getShopifyToken();

  const cleanNumber = String(orderNumber || "").trim().replace(/^#/, "");
  if (!cleanNumber) return null;
  const name = `#${cleanNumber}`;

  const url = `https://${shop}.myshopify.com/admin/api/2024-01/orders.json?name=${encodeURIComponent(name)}&status=any`;
  const response = await axios.get(url, {
    headers: {
      "X-Shopify-Access-Token": token,
      "Accept": "application/json",
    },
  });

  const orders = response.data.orders || [];
  if (orders.length === 0) return null;

  const order = orders[0];
  const orderEmail = (order.email || order.contact_email || "").trim().toLowerCase();
  const suppliedEmail = (email || "").trim().toLowerCase();

  if (!orderEmail || orderEmail !== suppliedEmail) {
    return { mismatch: true };
  }

  // Prefer the most recent fulfillment date as the "delivered" reference; fall back to order creation.
  let fulfillmentDate = null;
  if (Array.isArray(order.fulfillments) && order.fulfillments.length > 0) {
    const dates = order.fulfillments
      .map((f) => new Date(f.created_at))
      .filter((d) => !isNaN(d.getTime()));
    if (dates.length > 0) {
      fulfillmentDate = new Date(Math.max(...dates.map((d) => d.getTime())));
    }
  }

  let customerName = "";
  if (order.customer) {
    customerName = [order.customer.first_name, order.customer.last_name].filter(Boolean).join(" ").trim();
  }
  if (!customerName && order.shipping_address && order.shipping_address.name) {
    customerName = order.shipping_address.name;
  }

  const lineItems = (order.line_items || []).map((li) => ({
    lineItemId: String(li.id),
    productId: li.product_id ? String(li.product_id) : null,
    variantId: li.variant_id ? String(li.variant_id) : null,
    title: li.title,
    variantTitle: li.variant_title,
    quantity: li.quantity,
    sku: li.sku,
  }));

  return {
    mismatch: false,
    orderId: String(order.id),
    orderName: order.name,
    customerName,
    financialStatus: order.financial_status,
    fulfillmentStatus: order.fulfillment_status,
    fulfillmentDate: fulfillmentDate ? fulfillmentDate.toISOString() : null,
    createdAt: order.created_at,
    lineItems,
  };
}

module.exports = {
  createOrUpdateCustomer,
  findOrderByNameAndEmail,
};
