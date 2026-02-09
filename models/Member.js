import mongoose from "mongoose";

const actorSchema = new mongoose.Schema(
  {
    id: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
    name: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const activityEntrySchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      trim: true,
    },
    by: actorSchema,
    at: {
      type: Date,
      default: Date.now,
    },
    changes: {
      type: mongoose.Schema.Types.Mixed,
    },
  },
  { _id: false }
);

const paymentEntrySchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      default: 0,
    },
    type: {
      type: String,
      enum: ["payment", "adjustment"],
      default: "payment",
    },
    fee: {
      type: Number,
      default: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["Paid", "Pending", "Free Trial"],
    },
    by: actorSchema,
    at: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
    },
    allocations: {
      type: [
        new mongoose.Schema(
          {
            startDate: Date,
            endDate: Date,
            amount: Number,
          },
          { _id: false }
        ),
      ],
      default: [],
    },
  },
  { _id: false }
);

const cyclePaymentSchema = new mongoose.Schema(
  {
    amount: {
      type: Number,
      default: 0,
    },
    type: {
      type: String,
      enum: ["payment", "adjustment"],
      default: "payment",
    },
    by: actorSchema,
    at: {
      type: Date,
      default: Date.now,
    },
    note: {
      type: String,
      trim: true,
    },
  },
  { _id: false }
);

const paymentCycleSchema = new mongoose.Schema(
  {
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
    },
    cycleMonths: {
      type: Number,
      default: 1,
    },
    fee: {
      type: Number,
      default: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },
    status: {
      type: String,
      enum: ["Paid", "Pending", "Free Trial"],
      default: "Pending",
    },
    payments: {
      type: [cyclePaymentSchema],
      default: [],
    },
  },
  { _id: false }
);

const memberSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      required: true,
      trim: true,
    },
    dob: {
      type: Date,
    },
    gender: {
      type: String,
      enum: ["Male", "Female", "Other"],
      default: "Male",
    },
    address: {
      type: String,
      trim: true,
    },
    emergencyName: {
      type: String,
      trim: true,
    },
    emergencyPhone: {
      type: String,
      trim: true,
    },
    healthNotes: {
      type: String,
      trim: true,
    },
    membershipType: {
      type: String,
      default: "Basic",
    },
    startDate: {
      type: Date,
      required: true,
    },
    duration: {
      type: String,
      default: "1 Month",
    },
    fee: {
      type: Number,
      default: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    remainingAmount: {
      type: Number,
      default: 0,
    },
    paymentStatus: {
      type: String,
      enum: ["Paid", "Pending", "Free Trial"],
      default: "Paid",
    },
    personalTrainer: {
      type: String,
      enum: ["Not Assigned", "Assigned"],
      default: "Not Assigned",
    },
    assignedTrainer: {
      type: String,
      trim: true,
    },
    profilePic: {
      type: String,
      trim: true,
    },
    createdBy: actorSchema,
    updatedBy: actorSchema,
    activityHistory: {
      type: [activityEntrySchema],
      default: [],
    },
    paymentHistory: {
      type: [paymentEntrySchema],
      default: [],
    },
    paymentCycles: {
      type: [paymentCycleSchema],
      default: [],
    },
  },
  { timestamps: true }
);

const Member = mongoose.model("Member", memberSchema);

export default Member;
