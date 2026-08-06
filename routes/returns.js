const express = require("express");
const router = express.Router();
const axios = require("axios");

// Import Model
const Return = require("../models/Return");

// Import Middlewares & Utils
const uploadMiddleware = require("../middleware/upload");
const validateReturn = require("../middleware/validateReturn");
const adminAuth = require("../middleware/adminAuth");
const { uploadToCloudinary } = require("../utils/cloudinary");
const sendNotification = require("../services/notificationService");
const { getShopifyToken } = require("../utils/shopifyAuth");

// Route 1: POST /api/returns/submit
router.post("/submit", uploadMiddleware, validateReturn, async (req, res) => {
  try {
    const {
      orderId,
      customerName,
      customerEmail,
      customerPhone,
      orderDeliveryDate,
      type,
      reason,
      reasonDetail,
      exchangeSize,
    } = req.body;

    // 1. Server-side 5-day window enforcement
    const today = new Date();
    const deliveryDate = new Date(orderDeliveryDate);
    const diffTimeMs = today.getTime() - deliveryDate.getTime();
    const diffDays = diffTimeMs / (1000 * 60 * 60 * 24);

    if (diffDays > 5) {
      return res.status(400).json({
        error: "Return window has expired. Returns and exchanges are only accepted within 5 days of delivery.",
      });
    }

    // 2. Media validation for returns
    if (type === "return") {
      const imagesCount = req.files && req.files.images ? req.files.images.length : 0;
      const videoCount = req.files && req.files.video ? req.files.video.length : 0;

      if (imagesCount < 2) {
        return res.status(400).json({
          error: "Please upload at least 2 photos of the product",
        });
      }
      if (videoCount < 1) {
        return res.status(400).json({
          error: "Please upload a video showing the product, tag, and packaging",
        });
      }
    }

    // 3. Upload media to Cloudinary
    let imageUrls = [];
    let videoUrl = "";

    try {
      if (req.files && req.files.images) {
        const imageUploadPromises = req.files.images.map((file) =>
          uploadToCloudinary(file.buffer, "image")
        );
        const imageResults = await Promise.all(imageUploadPromises);
        imageUrls = imageResults.map((result) => result.secure_url);
      }

      if (req.files && req.files.video && req.files.video.length > 0) {
        const videoResult = await uploadToCloudinary(req.files.video[0].buffer, "video");
        videoUrl = videoResult.secure_url;
      }
    } catch (cloudinaryError) {
      console.error("Cloudinary upload error:", cloudinaryError);
      return res.status(500).json({
        error: "Failed to upload product media assets to cloud storage. Please try again.",
      });
    }

    // 4. Save Return Request to MongoDB
    const returnRequest = new Return({
      orderId,
      customerName,
      customerEmail,
      customerPhone,
      orderDeliveryDate,
      type,
      reason,
      reasonDetail,
      exchangeSize,
      media: {
        images: imageUrls,
        video: videoUrl,
      },
      status: "pending_review",
      notificationsSent: ["received"],
    });

    await returnRequest.save();

    // 5. Send customer receipt email notification
    await sendNotification(customerEmail, customerName, "request_received", {});

    // 6. Return response
    return res.status(201).json({
      success: true,
      message: "If the returned product passes our quality check parameters based on the photos submitted, the refund will be processed within 5–6 business days.",
      requestId: returnRequest._id,
    });
  } catch (error) {
    console.error("Error submitting return request:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 2: GET /api/returns/status/:requestId
router.get("/status/:requestId", async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.requestId);
    if (!returnRequest) {
      return res.status(404).json({ error: "Return request not found" });
    }

    return res.json({
      requestId: returnRequest._id,
      type: returnRequest.type,
      status: returnRequest.status,
      reason: returnRequest.reason,
      createdAt: returnRequest.createdAt,
      ...(returnRequest.status === "rejected" && {
        rejectionReason: returnRequest.rejectionReason,
      }),
    });
  } catch (error) {
    console.error("Error fetching request status:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 3: GET /api/returns/admin/all
router.get("/admin/all", adminAuth, async (req, res) => {
  try {
    const { status, type, startDate, endDate, orderId, page = 1, limit = 20 } = req.query;

    // Build dynamic query filter
    const filter = {};
    if (status) filter.status = status;
    if (type) filter.type = type;
    if (orderId) filter.orderId = orderId;

    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }

    const pageNum = parseInt(page) || 1;
    const limitNum = parseInt(limit) || 20;
    const skip = (pageNum - 1) * limitNum;

    const total = await Return.countDocuments(filter);
    const requests = await Return.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limitNum);

    return res.json({
      total,
      page: pageNum,
      limit: limitNum,
      requests,
    });
  } catch (error) {
    console.error("Error fetching admin requests:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 4: GET /api/returns/admin/:requestId
router.get("/admin/:requestId", adminAuth, async (req, res) => {
  try {
    const returnRequest = await Return.findById(req.params.requestId);
    if (!returnRequest) {
      return res.status(404).json({ error: "Return request not found" });
    }
    return res.json(returnRequest);
  } catch (error) {
    console.error("Error fetching request details:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 5: PATCH /api/returns/admin/:requestId/review
router.patch("/admin/:requestId/review", adminAuth, async (req, res) => {
  try {
    const { action, adminNote, rejectionReason } = req.body;

    if (!action || !["approve", "reject"].includes(action)) {
      return res.status(400).json({ error: "Invalid action. Must be 'approve' or 'reject'." });
    }

    if (action === "reject" && (!rejectionReason || rejectionReason.trim() === "")) {
      return res.status(400).json({ error: "Rejection reason is required" });
    }

    const returnRequest = await Return.findById(req.params.requestId);
    if (!returnRequest) {
      return res.status(404).json({ error: "Return request not found" });
    }

    returnRequest.reviewedAt = new Date();
    returnRequest.reviewedBy = "admin";
    if (adminNote) returnRequest.adminNote = adminNote;

    if (action === "approve") {
      returnRequest.status = "approved";
      if (!returnRequest.notificationsSent.includes("approved")) {
        returnRequest.notificationsSent.push("approved");
      }
      await returnRequest.save();

      if (returnRequest.type === "exchange") {
        await sendNotification(
          returnRequest.customerEmail,
          returnRequest.customerName,
          "exchange_confirmed",
          { exchangeSize: returnRequest.exchangeSize }
        );
      } else {
        await sendNotification(
          returnRequest.customerEmail,
          returnRequest.customerName,
          "return_approved",
          {}
        );
      }
    } else if (action === "reject") {
      returnRequest.status = "rejected";
      returnRequest.rejectionReason = rejectionReason;
      if (!returnRequest.notificationsSent.includes("rejected")) {
        returnRequest.notificationsSent.push("rejected");
      }
      await returnRequest.save();

      await sendNotification(
        returnRequest.customerEmail,
        returnRequest.customerName,
        "return_rejected",
        { rejectionReason }
      );
    }

    return res.json(returnRequest);
  } catch (error) {
    console.error("Error reviewing return request:", error);
    return res.status(500).json({ error: "Internal server error occurred." });
  }
});

// Route 6: GET /api/returns/sizes/:productId
router.get('/sizes/:productId', async (req, res) => {
  try {
    const token = await getShopifyToken();
    
    const response = await axios.get(
      `https://${process.env.SHOPIFY_SHOP}.myshopify.com/admin/api/2024-01/products/${req.params.productId}/variants.json`,
      {
        headers: {
          'X-Shopify-Access-Token': token
        }
      }
    );

    const availableSizes = response.data.variants
      .filter(v => v.inventory_quantity > 0)
      .map(v => v.title);

    res.json({
      productId: req.params.productId,
      availableSizes
    });

  } catch (error) {
    if (error.message.includes('Shopify token')) {
      return res.status(502).json({ error: 'Failed to authenticate with Shopify' });
    }
    res.status(502).json({ error: 'Failed to fetch sizes from Shopify', detail: error.message });
  }
});

// GET /api/returns/test-shopify
router.get("/test-shopify", async (req, res) => {
  try {
    const token = await getShopifyToken();
    return res.json({ success: true, message: "Shopify token acquired successfully" });
  } catch (error) {
    return res.status(502).json({ success: false, error: "Failed to get Shopify token", detail: error.message });
  }
});

module.exports = router;