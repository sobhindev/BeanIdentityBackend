// models/Return.js
const mongoose = require("mongoose");

const returnSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      required: true,
    },
    customerName: {
      type: String,
      required: true,
    },
    customerEmail: {
      type: String,
      required: true,
    },
    customerPhone: {
      type: String,
    },
    orderDeliveryDate: {
      type: Date,
      required: true,
    },
    type: {
      type: String,
      enum: ["return", "exchange"],
      required: true,
    },
    reason: {
      type: String,
      required: true,
    },
    reasonDetail: {
      type: String,
    },
    media: {
      images: {
        type: [String],
        default: [],
      },
      video: {
        type: String,
      },
    },
    exchangeSize: {
      type: String,
    },
    // --- Precise line-item targeting (added to support the Exchange flow) ---
    lineItemId: {
      type: String, // Shopify order line_item id the request refers to
    },
    productId: {
      type: String, // Shopify product id being returned/exchanged
    },
    variantId: {
      type: String, // Shopify variant id of the item the customer currently has
    },
    productTitle: {
      type: String,
    },
    currentVariantTitle: {
      type: String, // e.g. the size/color the customer currently owns
    },
    exchangeVariantId: {
      type: String, // Shopify variant id the customer wants in return (when resolvable)
    },
    // --- Order verification (added so the 5-day window can't be gamed by hand-typed dates) ---
    orderVerified: {
      type: Boolean,
      default: false, // true when orderId + customerEmail were matched against a real Shopify order at submit time
    },
    shopifyOrderName: {
      type: String, // Shopify's canonical order name (e.g. "#1023"), when verified
    },
    status: {
      type: String,
      enum: [
        "pending_review",
        "approved",
        "rejected",
        "refund_initiated",
        "completed",
      ],
      default: "pending_review",
    },
    adminNote: {
      type: String,
    },
    rejectionReason: {
      type: String,
    },
    reviewedBy: {
      type: String,
    },
    reviewedAt: {
      type: Date,
    },
    notificationsSent: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Return", returnSchema);