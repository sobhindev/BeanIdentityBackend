const multer = require("multer");

const storage = multer.memoryStorage();

const upload = multer({
  storage,
  limits: {
    fileSize: 100 * 1024 * 1024, // Set to the maximum allowed (100MB) for video
  },
  fileFilter: (req, file, cb) => {
    if (file.fieldname === "images") {
      const allowedImageTypes = ["image/jpeg", "image/png", "image/webp"];
      if (!allowedImageTypes.includes(file.mimetype)) {
        return cb(new Error("Invalid image type. Only JPEG, PNG, and WebP are allowed."), false);
      }
      cb(null, true);
    } else if (file.fieldname === "video") {
      const allowedVideoTypes = ["video/mp4", "video/quicktime"];
      if (!allowedVideoTypes.includes(file.mimetype)) {
        return cb(new Error("Invalid video type. Only MP4 and QuickTime (MOV) are allowed."), false);
      }
      cb(null, true);
    } else {
      cb(new Error("Unexpected field name."), false);
    }
  },
});

const uploadFields = upload.fields([
  { name: "images", maxCount: 5 },
  { name: "video", maxCount: 1 },
]);

// Custom middleware wrapper to enforce specific size limits and handle errors
const uploadMiddleware = (req, res, next) => {
  uploadFields(req, res, (err) => {
    if (err) {
      if (err instanceof multer.MulterError) {
        if (err.code === "LIMIT_UNEXPECTED_FILE") {
          return res.status(400).json({ error: "Too many files uploaded. Maximum of 5 images and 1 video are allowed." });
        }
        return res.status(400).json({ error: `Upload error: ${err.message}` });
      }
      return res.status(400).json({ error: err.message });
    }

    // Dynamic verification of individual file sizes
    if (req.files) {
      if (req.files.images) {
        const imageLimit = 10 * 1024 * 1024; // 10MB
        for (const file of req.files.images) {
          if (file.size > imageLimit) {
            return res.status(400).json({ error: `Image ${file.originalname} exceeds the 10MB size limit.` });
          }
        }
      }

      if (req.files.video) {
        const videoLimit = 100 * 1024 * 1024; // 100MB
        for (const file of req.files.video) {
          if (file.size > videoLimit) {
            return res.status(400).json({ error: `Video ${file.originalname} exceeds the 100MB size limit.` });
          }
        }
      }
    }

    next();
  });
};

module.exports = uploadMiddleware;
