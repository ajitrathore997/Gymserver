import express from "express";
import {
  createMemberController,
  getMembersController,
  getMemberByIdController,
  updateMemberController,
  deleteMemberController,
  getMemberDashboardController,
  adjustMemberPaymentHistoryController,
  addMemberPaymentController,
} from "../controlllers/memberController.js";
import { requireSignIn, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", requireSignIn, isAdmin, createMemberController);
router.get("/", requireSignIn, isAdmin, getMembersController);
router.get("/dashboard", requireSignIn, isAdmin, getMemberDashboardController);
router.get("/:id", requireSignIn, isAdmin, getMemberByIdController);
router.put("/:id", requireSignIn, isAdmin, updateMemberController);
router.put(
  "/:id/payment-history",
  requireSignIn,
  isAdmin,
  adjustMemberPaymentHistoryController
);
router.post(
  "/:id/pay",
  requireSignIn,
  isAdmin,
  addMemberPaymentController
);
router.delete("/:id", requireSignIn, isAdmin, deleteMemberController);

export default router;
