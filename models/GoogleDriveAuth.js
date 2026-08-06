const mongoose = require("mongoose");

const googleDriveAuthSchema = new mongoose.Schema(
  {
    accessToken: {
      type: String,
      required: true,
    },
    refreshToken: {
      type: String,
      required: true,
    },
    expiryDate: {
      type: Date,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    folderId: {
      type: String,
      default: "",
    },
  },
  {
    timestamps: true,
  }
);

module.exports = mongoose.model("GoogleDriveAuth", googleDriveAuthSchema);
