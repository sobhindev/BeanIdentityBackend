// models/Story.js
const mongoose = require("mongoose");

const storySchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    handle: {
      type: String, // Optional - Instagram handle
    },
    beanType: {
      type: String,
      enum: ["coffee", "chilli", "vanilla", "jelly", "green"],
      required: true,
    },
    story: {
      type: String,
      required: true,
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
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
    isPublished: {
      type: Boolean,
      default: false,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("Story", storySchema);
