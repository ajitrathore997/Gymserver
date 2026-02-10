import mongoose from "mongoose";

const actorSchema = new mongoose.Schema(
  {
    id: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    name: { type: String, trim: true },
  },
  { _id: false }
);

const inquirySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, trim: true },
    email: { type: String, trim: true },
    source: { type: String, trim: true }, // walk-in, call, social, etc
    status: {
      type: String,
      enum: ["New", "Contacted", "Interested", "Not Interested", "Joined", "Follow Up"],
      default: "New",
    },
    nextFollowUpDate: { type: Date },
    lastContactedAt: { type: Date },
    note: { type: String, trim: true },
    followUps: {
      type: [
        new mongoose.Schema(
          {
            date: { type: Date },
            note: { type: String, trim: true },
            status: {
              type: String,
              enum: ["Planned", "Done", "Missed"],
              default: "Planned",
            },
            by: actorSchema,
            createdAt: { type: Date, default: Date.now },
          },
          { _id: false }
        ),
      ],
      default: [],
    },
    createdBy: actorSchema,
    updatedBy: actorSchema,
  },
  { timestamps: true }
);

const Inquiry = mongoose.model("Inquiry", inquirySchema);

export default Inquiry;
