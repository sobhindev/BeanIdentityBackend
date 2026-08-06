const express = require("express");
const router = express.Router();
const { google } = require("googleapis");

// Import Model
const Story = require("../models/Story");
const GoogleDriveAuth = require("../models/GoogleDriveAuth");

// Import Middlewares & Utils
const uploadMiddleware = require("../middleware/upload");
const adminAuth = require("../middleware/adminAuth");
const {
  loadOAuthCredentials,
  getAuthClient,
  uploadToGoogleDrive,
  deleteFromGoogleDrive,
} = require("../utils/googleDrive");

// helper to calculate word count
const getWordCount = (str) => {
  if (!str || str.trim() === "") return 0;
  return str.trim().split(/\s+/).length;
};

// Route 1: POST /api/stories/submit - Submit a story with optional media (public)
router.post("/submit", uploadMiddleware, async (req, res) => {
  try {
    const { name, email, handle, beanType, story } = req.body;

    // 1. Validation
    if (!name || !email || !beanType || !story) {
      return res.status(400).json({ error: "Missing required fields." });
    }

    if (!["coffee", "chilli", "vanilla", "jelly", "green"].includes(beanType)) {
      return res.status(400).json({ error: "Invalid bean type." });
    }

    // Word count enforcement
    if (getWordCount(story) > 150) {
      return res.status(400).json({ error: "Story exceeds the maximum limit of 150 words." });
    }

    // Check if Google Drive storage is configured first
    const driveLinked = await GoogleDriveAuth.findOne();
    if (!driveLinked || !driveLinked.refreshToken) {
      return res.status(530).json({
        error: "Story submissions are temporarily unavailable. Storage provider is not configured.",
      });
    }

    // 2. Upload media assets to Google Drive (if provided)
    let imageUrls = [];
    let videoUrl = "";

    try {
      if (req.files && req.files.images) {
        // Enforce max 3 images for stories
        const imagesToUpload = req.files.images.slice(0, 3);
        const imageUploadPromises = imagesToUpload.map((file) =>
          uploadToGoogleDrive(file.buffer, file.originalname, file.mimetype, {
            beanType,
            userName: name,
            userEmail: email,
          })
        );
        const imageResults = await Promise.all(imageUploadPromises);
        imageUrls = imageResults.map((result) => result.proxyUrl);
      }

      if (req.files && req.files.video && req.files.video.length > 0) {
        const videoResult = await uploadToGoogleDrive(
          req.files.video[0].buffer,
          req.files.video[0].originalname,
          req.files.video[0].mimetype,
          {
            beanType,
            userName: name,
            userEmail: email,
          }
        );
        videoUrl = videoResult.proxyUrl;
      }
    } catch (uploadError) {
      console.error("Google Drive upload error in stories:", uploadError);
      return res.status(500).json({
        error: "Failed to upload story media assets to storage. Please try again.",
      });
    }

    // 3. Save pending Story to MongoDB
    const newStory = new Story({
      name,
      email,
      handle: handle || "",
      beanType,
      story,
      media: {
        images: imageUrls,
        video: videoUrl,
      },
      status: "pending",
    });

    await newStory.save();

    return res.status(201).json({
      success: true,
      message: "Thank you for sharing your bean story! It has been submitted to our moderation queue.",
      storyId: newStory._id,
    });
  } catch (error) {
    console.error("Error submitting story request:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 2: GET /api/stories/approved - Fetch top 5 approved stories (public)
router.get("/approved", async (req, res) => {
  try {
    const stories = await Story.find({ status: "approved", isPublished: true })
      .sort({ createdAt: -1 })
      .limit(5);

    return res.json(stories);
  } catch (error) {
    console.error("Error fetching approved stories:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 3: GET /api/stories/admin/all - Get all stories in moderation queue (admin only)
router.get("/admin/all", adminAuth, async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;

    const filter = {};
    if (status) filter.status = status;

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const total = await Story.countDocuments(filter);
    const stories = await Story.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    return res.json({
      total,
      page: pageNum,
      limit: limitNum,
      stories,
    });
  } catch (error) {
    console.error("Error fetching admin stories:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 4: PATCH /api/stories/admin/:storyId/review - Approve/reject a story (admin only)
router.patch("/admin/:storyId/review", adminAuth, async (req, res) => {
  try {
    const { action } = req.body;

    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Must be 'approve' or 'reject'." });
    }

    const story = await Story.findById(req.params.storyId);
    if (!story) {
      return res.status(404).json({ error: "Story not found." });
    }

    if (action === "reject") {
      story.status = "rejected";

      // Delete files from Google Drive
      const deletePromises = [];

      if (story.media && story.media.images && story.media.images.length > 0) {
        story.media.images.forEach((imgUrl) => {
          const fileId = imgUrl.substring(imgUrl.lastIndexOf("/") + 1);
          if (fileId) {
            deletePromises.push(deleteFromGoogleDrive(fileId));
          }
        });
      }

      if (story.media && story.media.video) {
        const fileId = story.media.video.substring(story.media.video.lastIndexOf("/") + 1);
        if (fileId) {
          deletePromises.push(deleteFromGoogleDrive(fileId));
        }
      }

      if (deletePromises.length > 0) {
        try {
          await Promise.all(deletePromises);
        } catch (err) {
          console.error("Failed to delete files from Google Drive during story rejection:", err);
        }
      }

      // Clear media references
      story.media = {
        images: [],
        video: "",
      };
    } else {
      story.status = "approved";
    }

    story.reviewedAt = new Date();
    story.reviewedBy = "admin";

    await story.save();

    return res.json({
      success: true,
      message: `Story has been successfully ${story.status}.`,
      story,
    });
  } catch (error) {
    console.error("Error reviewing story request:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 5: GET /api/stories/admin/google/auth-url - Generate Google OAuth URL (admin only)
router.get("/admin/google/auth-url", adminAuth, async (req, res) => {
  try {
    const creds = loadOAuthCredentials();
    if (!creds.clientId || !creds.clientSecret || !creds.redirectUri) {
      return res.status(500).json({ error: "Google OAuth credentials not configured in environment." });
    }

    const oauth2Client = new google.auth.OAuth2(
      creds.clientId,
      creds.clientSecret,
      creds.redirectUri
    );

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent",
      scope: [
        "https://www.googleapis.com/auth/drive",
        "https://www.googleapis.com/auth/userinfo.email",
      ],
      state: req.headers["x-admin-key"],
    });

    return res.json({ authUrl });
  } catch (error) {
    console.error("Error generating OAuth URL:", error);
    return res.status(500).json({ error: "Failed to generate auth URL." });
  }
});

// Route 6: GET /api/stories/admin/google/callback - Google OAuth Callback (public endpoint)
router.get("/admin/google/callback", async (req, res) => {
  try {
    const { code, state: adminKey, error } = req.query;
    const adminPortalUrl = process.env.ADMIN_PORTAL_URL || "https://beanspot-2.myshopify.com/pages/admin-portal";

    if (error) {
      console.error("Google OAuth error callback:", error);
      return res.redirect(`${adminPortalUrl}?googleDriveConnect=error&reason=${encodeURIComponent(error)}`);
    }

    if (!code || !adminKey) {
      return res.redirect(`${adminPortalUrl}?googleDriveConnect=error&reason=MissingParameters`);
    }

    // Verify admin key
    if (adminKey !== process.env.ADMIN_SECRET) {
      return res.redirect(`${adminPortalUrl}?googleDriveConnect=error&reason=Unauthorized`);
    }

    const creds = loadOAuthCredentials();
    const oauth2Client = new google.auth.OAuth2(
      creds.clientId,
      creds.clientSecret,
      creds.redirectUri
    );

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    // Fetch user's Google email
    const oauth2 = google.oauth2({ version: "v2", auth: oauth2Client });
    const userInfo = await oauth2.userinfo.get();
    const email = userInfo.data.email;

    if (!tokens.refresh_token) {
      const existingAuth = await GoogleDriveAuth.findOne();
      if (existingAuth && existingAuth.refreshToken) {
        tokens.refresh_token = existingAuth.refreshToken;
      } else {
        return res.redirect(`${adminPortalUrl}?googleDriveConnect=error&reason=NoRefreshToken`);
      }
    }

    // Save tokens to MongoDB
    await GoogleDriveAuth.deleteMany({});
    const newAuth = new GoogleDriveAuth({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiryDate: tokens.expiry_date ? new Date(tokens.expiry_date) : new Date(Date.now() + 3600 * 1000),
      email: email,
    });
    await newAuth.save();

    return res.redirect(`${adminPortalUrl}?googleDriveConnect=success`);
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    const adminPortalUrl = process.env.ADMIN_PORTAL_URL || "https://beanspot-2.myshopify.com/pages/admin-portal";
    return res.redirect(`${adminPortalUrl}?googleDriveConnect=error&reason=${encodeURIComponent(err.message)}`);
  }
});

// Route 7: GET /api/stories/admin/google/status - Get Google Drive connection status (admin only)
router.get("/admin/google/status", adminAuth, async (req, res) => {
  try {
    const authDoc = await GoogleDriveAuth.findOne();
    if (!authDoc || !authDoc.refreshToken) {
      return res.json({ isConnected: false });
    }
    return res.json({
      isConnected: true,
      email: authDoc.email,
    });
  } catch (error) {
    console.error("Error getting Google Drive status:", error);
    return res.status(500).json({ error: "Failed to fetch status." });
  }
});

// Route 8: POST /api/stories/admin/google/disconnect - Disconnect Google Drive (admin only)
router.post("/admin/google/disconnect", adminAuth, async (req, res) => {
  try {
    await GoogleDriveAuth.deleteMany({});
    return res.json({ success: true, message: "Google Drive disconnected successfully." });
  } catch (error) {
    console.error("Error disconnecting Google Drive:", error);
    return res.status(500).json({ error: "Failed to disconnect Google Drive." });
  }
});

// Route 9: GET /api/stories/media/:fileId - Proxy stream media from Google Drive (public endpoint)
router.get("/media/:fileId", async (req, res) => {
  try {
    const { fileId } = req.params;
    if (!fileId) {
      return res.status(400).send("Missing file ID");
    }

    res.setHeader("Cache-Control", "public, max-age=31536000");
    res.setHeader("Access-Control-Allow-Origin", "*");

    const auth = await getAuthClient();
    const drive = google.drive({ version: "v3", auth });

    const requestOptions = {
      responseType: "stream",
    };

    if (req.headers.range) {
      requestOptions.headers = {
        Range: req.headers.range,
      };
    }

    const driveRes = await drive.files.get(
      { fileId, alt: "media" },
      requestOptions
    );

    // Set response status code (e.g. 200 or 206)
    res.status(driveRes.status);

    // Copy necessary headers from Drive's response
    const headersToCopy = [
      "content-range",
      "content-length",
      "content-type",
      "accept-ranges",
      "content-disposition",
      "cache-control"
    ];

    headersToCopy.forEach((header) => {
      const value = typeof driveRes.headers.get === "function"
        ? driveRes.headers.get(header)
        : driveRes.headers[header];
      if (value) {
        res.setHeader(header, value);
      }
    });

    // Explicitly support range seeking
    res.setHeader("Accept-Ranges", "bytes");

    driveRes.data
      .on("error", (err) => {
        console.error("Google Drive stream error:", err.message);
        if (!res.headersSent) res.status(500).send("Stream failed");
      })
      .pipe(res);
  } catch (error) {
    console.error("Error streaming file from Google Drive:", error.message);
    if (!res.headersSent) {
      res.status(500).send("Internal Server Error");
    }
  }
});

// Route 10: PATCH /api/stories/admin/:storyId/publish - Publish/unpublish an approved story (admin only)
router.patch("/admin/:storyId/publish", adminAuth, async (req, res) => {
  try {
    const { isPublished } = req.body;

    if (typeof isPublished !== "boolean") {
      return res.status(400).json({ error: "Invalid parameters. 'isPublished' must be a boolean." });
    }

    const story = await Story.findById(req.params.storyId);
    if (!story) {
      return res.status(404).json({ error: "Story not found." });
    }

    if (story.status !== "approved") {
      return res.status(400).json({ error: "Only approved stories can be published or unpublished." });
    }

    story.isPublished = isPublished;
    await story.save();

    return res.json({
      success: true,
      message: `Story has been successfully ${isPublished ? "published" : "unpublished"}.`,
      story,
    });
  } catch (error) {
    console.error("Error publishing story request:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

module.exports = router;
