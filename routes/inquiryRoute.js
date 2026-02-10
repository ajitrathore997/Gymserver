import express from "express";
import {
  createInquiryController,
  getInquiriesController,
  updateInquiryController,
  deleteInquiryController,
} from "../controlllers/inquiryController.js";
import { requireSignIn, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", requireSignIn, isAdmin, createInquiryController);
router.get("/", requireSignIn, isAdmin, getInquiriesController);
router.put("/:id", requireSignIn, isAdmin, updateInquiryController);
router.delete("/:id", requireSignIn, isAdmin, deleteInquiryController);

export default router;
