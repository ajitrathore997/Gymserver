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

const supplementSaleSchema = new mongoose.Schema(
  {
    supplementName: {
      type: String,
      required: true,
      trim: true,
    },
    memberName: {
      type: String,
      required: true,
      trim: true,
    },
    memberPhone: {
      type: String,
      trim: true,
    },
    totalAmount: {
      type: Number,
      required: true,
      min: 0,
      default: 0,
    },
    paidAmount: {
      type: Number,
      min: 0,
      default: 0,
    },
    buyDate: {
      type: Date,
    },
    paymentDueDate: {
      type: Date,
    },
    note: {
      type: String,
      trim: true,
    },
    createdBy: actorSchema,
    updatedBy: actorSchema,
  },
  { timestamps: true }
);

const SupplementSale = mongoose.model("SupplementSale", supplementSaleSchema);

export default SupplementSale;
