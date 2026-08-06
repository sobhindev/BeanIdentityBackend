let cachedToken = null;
let tokenExpiresAt = 0; // Timestamp in ms

/**
 * Fetches or returns a cached Shopify OAuth access token using the Client Credentials grant.
 * Caches the token in-memory and automatically refreshes it before it expires.
 * 
 * @returns {Promise<string>} The Shopify access token
 */
async function getShopifyToken() {
  const shop = process.env.SHOPIFY_SHOP || "beanidentity";
  const clientId = process.env.SHOPIFY_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing SHOPIFY_CLIENT_ID or SHOPIFY_CLIENT_SECRET in environment variables.");
  }

  const now = Date.now();

  // Cache hit: return token if it exists and expires in more than 60 seconds
  if (cachedToken && (tokenExpiresAt - now > 60000)) {
    return cachedToken;
  }

  // Cache miss or expiring token: request a new one via Client Credentials Grant
  try {
    const bodyParams = new URLSearchParams();
    bodyParams.append("grant_type", "client_credentials");
    bodyParams.append("client_id", clientId);
    bodyParams.append("client_secret", clientSecret);

    const response = await fetch(`https://${shop}.myshopify.com/admin/oauth/access_token`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: bodyParams.toString(),
    });

    if (!response.ok) {
      throw new Error(`Shopify token request failed: ${response.status}`);
    }

    const data = await response.json();
    const { access_token, expires_in } = data;

    if (!access_token) {
      throw new Error("No access_token returned by Shopify in OAuth response.");
    }

    cachedToken = access_token;
    // expires_in is in seconds, convert to milliseconds
    tokenExpiresAt = Date.now() + (expires_in * 1000);

    console.log(`[ShopifyAuth] Successfully fetched and cached new token. Expires at: ${new Date(tokenExpiresAt).toISOString()}`);
    return cachedToken;
  } catch (error) {
    console.error("[ShopifyAuth] Error fetching access token:", error.message);
    throw error;
  }
}

module.exports = {
  getShopifyToken,
};
