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