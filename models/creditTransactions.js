import mongoose from "mongoose";

const creditTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },

    action: {
      type: String,
      enum: [
        "upload",
        "purchase",
        "redeem",
        "delete_upload",
        "delete_purchase"
      ],
      required: true
    },

    points: {
      type: Number,
      required: true
    },

    metadata: {
      type: Object,  // e.g. { contactIds: [...], count: X }
      default: {}
    }
  },
  { timestamps: true }
);

export default mongoose.model(
  "CreditTransactions",
  creditTransactionSchema,
  "creditTransactions"
);
