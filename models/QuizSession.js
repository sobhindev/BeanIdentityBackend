// models/QuizSession.js
const mongoose = require("mongoose");

const quizSessionSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    email: {
      type: String,
      required: true,
    },
    referredByResult: {
      type: String,
      default: null,
    },
    userAgent: {
      type: String,
    },
    ipAddress: {
      type: String,
    },
    furthestStep: {
      type: Number,
      default: 0, // 0 = welcome, 1-8 = questions, 9 = completed
    },
    answers: {
      type: Map,
      of: String, // maps step number to option weight string
      default: {},
    },
    scores: {
      coffee: { type: Number, default: 0 },
      chilli: { type: Number, default: 0 },
      vanilla: { type: Number, default: 0 },
      jelly: { type: Number, default: 0 },
      green: { type: Number, default: 0 },
    },
    winningArchetype: {
      type: String,
      default: null, // winning profile key or dual blend key
    },
    resultType: {
      type: String,
      enum: ["single", "dominant", "dual_blend", "true_blend", null],
      default: null,
    },
    isCompleted: {
      type: Boolean,
      default: false,
    },
  },
  {
    timestamps: true,
  }
);

// Optimize aggregations and queries
quizSessionSchema.index({ email: 1 });
quizSessionSchema.index({ furthestStep: 1 });
quizSessionSchema.index({ isCompleted: 1 });

module.exports = mongoose.model("QuizSession", quizSessionSchema);
