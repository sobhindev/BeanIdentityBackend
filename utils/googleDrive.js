const { google } = require("googleapis");
const { Readable } = require("stream");
const GoogleDriveAuth = require("../models/GoogleDriveAuth");

/**
 * Load Google OAuth2 credentials from Environment Variables
 */
function loadOAuthCredentials() {
  return {
    clientId: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    redirectUri: process.env.GOOGLE_REDIRECT_URI,
  };
}

/**
 * Build an authenticated OAuth2 client for the admin.
 * Automatically refreshes access token if expired and updates MongoDB.
 */
async function getAuthClient() {
  const creds = loadOAuthCredentials();
  if (!creds.clientId || !creds.clientSecret || !creds.redirectUri) {
    throw new Error("Google OAuth credentials not configured in environment variables.");
  }

  const authDoc = await GoogleDriveAuth.findOne();
  if (!authDoc || !authDoc.refreshToken) {
    throw new Error("Google Drive is not linked. Please connect your Google account in the Admin Portal.");
  }

  const oauth2Client = new google.auth.OAuth2(
    creds.clientId,
    creds.clientSecret,
    creds.redirectUri
  );

  oauth2Client.setCredentials({
    access_token: authDoc.accessToken,
    refresh_token: authDoc.refreshToken,
    expiry_date: authDoc.expiryDate ? new Date(authDoc.expiryDate).getTime() : null,
  });

  // Auto-refresh listener: update DB when token is refreshed
  oauth2Client.on("tokens", async (tokens) => {
    try {
      const updateData = {};
      if (tokens.access_token) {
        updateData.accessToken = tokens.access_token;
      }
      if (tokens.expiry_date) {
        updateData.expiryDate = new Date(tokens.expiry_date);
      }
      if (tokens.refresh_token) {
        updateData.refreshToken = tokens.refresh_token;
      }

      if (Object.keys(updateData).length > 0) {
        await GoogleDriveAuth.updateOne({}, { $set: updateData });
        console.log("Google Drive access token refreshed and saved to MongoDB.");
      }
    } catch (err) {
      console.error("Failed to update refreshed token in MongoDB:", err.message);
    }
  });

  return oauth2Client;
}

/**
 * Upload a file buffer to Google Drive
 */
async function uploadToGoogleDrive(fileBuffer, originalName, mimeType, options = {}) {
  const auth = await getAuthClient();
  const drive = google.drive({ version: "v3", auth });

  // Convert buffer to readable stream
  const stream = new Readable();
  stream.push(fileBuffer);
  stream.push(null);

  // Upload to Drive
  const response = await drive.files.create({
    requestBody: {
      name: `${Date.now()}-${originalName}`,
    },
    media: {
      mimeType: mimeType,
      body: stream,
    },
    fields: "id, name, webViewLink, webContentLink",
  });

  const file = response.data;

  // Make the file publicly readable so it can be streamed or accessed via public links
  try {
    await drive.permissions.create({
      fileId: file.id,
      requestBody: {
        role: "reader",
        type: "anyone",
      },
    });
  } catch (err) {
    console.warn("Failed to set public read permissions on Google Drive file:", err.message);
  }

  // Use a relative backend proxy URL to ensure portability between local/prod environments
  const proxyUrl = `/api/stories/media/${file.id}`;

  return {
    fileId: file.id,
    webViewLink: file.webViewLink,
    webContentLink: file.webContentLink,
    proxyUrl: proxyUrl,
  };
}

/**
 * Delete a file from Google Drive
 */
async function deleteFromGoogleDrive(fileId) {
  if (!fileId) return;
  const auth = await getAuthClient();
  const drive = google.drive({ version: "v3", auth });
  try {
    await drive.files.delete({ fileId });
    console.log(`Successfully deleted file ${fileId} from Google Drive.`);
  } catch (error) {
    console.error(`Failed to delete file ${fileId} from Google Drive:`, error.message);
    if (error.code !== 404) {
      throw error;
    }
  }
}

module.exports = {
  loadOAuthCredentials,
  getAuthClient,
  uploadToGoogleDrive,
  deleteFromGoogleDrive,
};
