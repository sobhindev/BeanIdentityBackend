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
const { findOrderByNameAndEmail } = require("../services/shopifyService");

// Route 0: GET /api/returns/order-lookup
// Verifies an order number + email against Shopify and returns its line items so the
// storefront request form can let the customer pick the exact item to return/exchange,
// instead of asking them to type in a product/size/date by hand.
router.get("/order-lookup", async (req, res) => {
  try {
    const { orderNumber, email } = req.query;

    if (!orderNumber || !email) {
      return res.status(400).json({
        error: "Both orderNumber and email are required.",
      });
    }

    const result = await findOrderByNameAndEmail(orderNumber, email);

    if (!result) {
      return res.status(404).json({
        error: "We couldn't find an order with that number. Please double-check and try again.",
      });
    }

    if (result.mismatch) {
      return res.status(403).json({
        error: "That email address doesn't match the one used to place this order.",
      });
    }

    const referenceDate = result.fulfillmentDate || result.createdAt;
    let eligible = true;
    let diffDays = null;
    if (referenceDate) {
      diffDays = (Date.now() - new Date(referenceDate).getTime()) / (1000 * 60 * 60 * 24);
      eligible = diffDays <= 5;
    }

    return res.json({
      orderName: result.orderName,
      customerName: result.customerName || "",
      referenceDate,
      eligible,
      daysSinceDelivery: diffDays !== null ? Math.floor(diffDays) : null,
      lineItems: result.lineItems,
    });
  } catch (error) {
    console.error("Error looking up order for return/exchange:", error);
    return res.status(502).json({
      error: "Failed to verify this order with Shopify. Please try again shortly.",
      detail: error.message,
    });
  }
});

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
      lineItemId,
      productId,
      variantId,
      productTitle,
      currentVariantTitle,
      exchangeVariantId,
    } = req.body;

    // 1. Verify the order against Shopify so the 5-day window is measured against a real
    //    fulfillment date rather than whatever date the customer types in. If Shopify can't
    //    be reached, or the order predates the app / was placed as a draft, we fall back to
    //    the customer-supplied date and flag the request as unverified for admin review.
    let deliveryReferenceDate = new Date(orderDeliveryDate);
    let orderVerified = false;
    let shopifyOrderName = orderId;

    try {
      const orderResult = await findOrderByNameAndEmail(orderId, customerEmail);

      if (orderResult && orderResult.mismatch) {
        return res.status(403).json({
          error: "The order ID and email address don't match our records.",
        });
      }

      if (orderResult) {
        orderVerified = true;
        shopifyOrderName = orderResult.orderName;
        const referenceDate = orderResult.fulfillmentDate || orderResult.createdAt;
        if (referenceDate) {
          deliveryReferenceDate = new Date(referenceDate);
        }
      }
    } catch (lookupError) {
      console.warn(
        "[Returns] Shopify order verification unavailable, falling back to submitted delivery date:",
        lookupError.message
      );
    }

    // 2. Server-side 5-day window enforcement (never trust the client alone for this)
    const today = new Date();
    const diffTimeMs = today.getTime() - deliveryReferenceDate.getTime();
    const diffDays = diffTimeMs / (1000 * 60 * 60 * 24);

    if (diffDays > 5) {
      return res.status(400).json({
        error: "Return window has expired. Returns and exchanges are only accepted within 5 days of delivery.",
      });
    }

    // 3. Media validation for returns
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

    // 4. Upload media to Cloudinary
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

    // 5. Save Return Request to MongoDB
    const returnRequest = new Return({
      orderId,
      shopifyOrderName,
      orderVerified,
      customerName,
      customerEmail,
      customerPhone,
      orderDeliveryDate,
      type,
      reason,
      reasonDetail,
      exchangeSize,
      lineItemId,
      productId,
      variantId,
      productTitle,
      currentVariantTitle,
      exchangeVariantId,
      media: {
        images: imageUrls,
        video: videoUrl,
      },
      status: "pending_review",
      notificationsSent: ["received"],
    });

    await returnRequest.save();

    // 6. Send customer receipt email notification
    await sendNotification(customerEmail, customerName, "request_received", {
      type,
      productTitle,
    });

    // 7. Return response
    return res.status(201).json({
      success: true,
      message:
        type === "exchange"
          ? "We've received your exchange request. If it passes our quality check, we'll confirm your replacement size within 5–6 business days."
          : "If the returned product passes our quality check parameters based on the photos submitted, the refund will be processed within 5–6 business days.",
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
          {
            exchangeSize: returnRequest.exchangeSize,
            productTitle: returnRequest.productTitle,
          }
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

// Route 5b: PATCH /api/returns/admin/:requestId/fulfillment
// Lets staff mark an approved request as fulfilled once they've manually processed the
// refund or shipped the replacement item outside this system. Exchanges are fully manual
// today (no automatic Shopify order is created), so this is how a request leaves "approved"
// and stops showing as outstanding work.
router.patch("/admin/:requestId/fulfillment", adminAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const allowedStatuses = ["refund_initiated", "completed"];

    if (!status || !allowedStatuses.includes(status)) {
      return res.status(400).json({
        error: `Invalid status. Must be one of: ${allowedStatuses.join(", ")}.`,
      });
    }

    const returnRequest = await Return.findById(req.params.requestId);
    if (!returnRequest) {
      return res.status(404).json({ error: "Return request not found" });
    }

    if (returnRequest.status !== "approved" && returnRequest.status !== "refund_initiated") {
      return res.status(400).json({
        error: "Only an approved request can be marked as refund_initiated or completed.",
      });
    }

    returnRequest.status = status;
    await returnRequest.save();

    return res.json(returnRequest);
  } catch (error) {
    console.error("Error updating return fulfillment status:", error);
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

    const inStockVariants = response.data.variants.filter(v => v.inventory_quantity > 0);

    const availableSizes = inStockVariants.map(v => v.title);
    // Also expose variant IDs alongside their titles so the exchange flow can record
    // precisely which variant the customer wants, not just a free-text size label.
    const availableVariants = inStockVariants.map(v => ({ id: v.id, title: v.title }));

    res.json({
      productId: req.params.productId,
      availableSizes,
      availableVariants
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