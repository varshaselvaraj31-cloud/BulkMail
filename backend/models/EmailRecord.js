const mongoose = require("mongoose");

const emailRecordSchema = new mongoose.Schema(
  {
    subject: { type: String, required: true, maxlength: 200 },
    body: { type: String, required: true, maxlength: 20000 },
    recipients: {
      type: [{ type: String, required: true }],
      required: true,
      validate: {
        validator: (recipients) => recipients.length > 0 && recipients.length <= 100,
        message: "An email record must have between 1 and 100 recipients.",
      },
    },
    status: { type: String, enum: ["sending", "sent", "failed"], required: true },
    messageId: String,
    error: String,
    sentAt: Date,
  },
  { timestamps: true },
);

module.exports = mongoose.model("EmailRecord", emailRecordSchema);
