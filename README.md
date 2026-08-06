# Bean Identity Backend Service Documentation

This document outlines the file structure of the Express.js backend and explains how to toggle the API URL between **Local Development** and the **Production Render Server** for both the backend and frontend Shopify theme.

---

## 📁 Backend Directory Structure

Here is a breakdown of the key files and folders in the `backend/` directory:

*   **`server.js`**: The main entry point of the Express application. Configures CORS, initializes middleware, connects to MongoDB, and registers routes.
*   **`config/`**:
    *   **`db.js`**: Handles the Mongoose connection initialization to the MongoDB Atlas cluster.
*   **`models/`**:
    *   **`Story.js`**: Mongoose model schema for members' bean stories (stores handle, text, images, video URL, approval status).
    *   **`Return.js`**: Mongoose model schema for order return/exchange requests.
*   **`routes/`**:
    *   **`stories.js`**: API routes for stories (`POST /submit` for public submissions, `GET /approved` for home page carousel, and `admin/` routes for approvals/rejections).
    *   **`returns.js`**: API routes for processing returns and exchanges, integrating with Shopify's Admin API.
*   **`middleware/`**:
    *   **`upload.js`**: Configures Multer storage limits (10MB image, 100MB video) and performs file size verification.
    *   **`adminAuth.js`**: Verifies the pre-shared `ADMIN_SECRET` key passed in request headers.
*   **`services/`**:
    *   **`notificationService.js`**: Sends transactional email notifications (Gmail SMTP transport via Nodemailer) for return approvals/rejections/confirmations.
*   **`utils/`**:
    *   **`cloudinary.js`**: Helper function to upload buffered media files to Cloudinary cloud storage.
    *   **`shopifyAuth.js`**: Handles OAuth token generation & caching for Shopify Admin API requests.
*   **`.env`**: Contains environment configurations (secrets, API keys, credentials).

---

## 🔄 Switching Between Local and Production URL

To switch environments, you need to toggle the configurations in **two locations**:

### 1. Backend Service Configuration (`backend/.env`)

In the backend [.env](file:///c:/Users/HP/Desktop/Bean/backend/.env) file, uncomment the target environment and comment out the other:

```env
# --- BACKEND API URL ---
# Local Development (uncomment to run locally)
# BACKEND_URL=http://localhost:5000

# Production Render Server (uncomment to run on Render)
BACKEND_URL=https://beanidentitybackend.onrender.com
SHOPIFY_STORE_URL=https://beanidentitybackend.onrender.com
```

---

### 2. Shopify Storefront Theme (Single Source of Truth)

To switch the URL on your storefront frontend, you only need to modify **one file**:

#### 📍 [layout/theme.liquid](file:///c:/Users/HP/Desktop/Bean/BEAN%20IDENTITY/layout/theme.liquid#L348)
Navigate to the `<script>` tag inside `layout/theme.liquid` and toggle the commented line:

```javascript
// Backend API Single Source of Truth
// window.beanBackendUrl = 'http://localhost:5000'; // Local Development
window.beanBackendUrl = 'https://beanidentitybackend.onrender.com'; // Production Render
```

Both dependent liquid sections ([beanagram-stories.liquid](file:///c:/Users/HP/Desktop/Bean/BEAN%20IDENTITY/sections/beanagram-stories.liquid) and [admin-portal.liquid](file:///c:/Users/HP/Desktop/Bean/BEAN%20IDENTITY/sections/admin-portal.liquid)) automatically consume `window.beanBackendUrl` and will switch instantly.
