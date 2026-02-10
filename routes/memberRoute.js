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
  uploadMemberProfileController,
  updateMemberPaymentStatusController,
  deleteMemberPaymentHistoryController,
} from "../controlllers/memberController.js";
import { requireSignIn, isAdmin } from "../Middlewares/authMiddleware.js";
import multer from "multer";
import fs from "fs";
import path from "path";

const router = express.Router();

const uploadDir = path.join(process.cwd(), "uploads");
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

router.post(
  "/upload",
  requireSignIn,
  isAdmin,
  upload.single("profilePic"),
  uploadMemberProfileController
);

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
router.put(
  "/:id/payment-history/:index/status",
  requireSignIn,
  isAdmin,
  updateMemberPaymentStatusController
);
router.delete(
  "/:id/payment-history/:index",
  requireSignIn,
  isAdmin,
  deleteMemberPaymentHistoryController
);
router.post(
  "/:id/pay",
  requireSignIn,
  isAdmin,
  addMemberPaymentController
);
router.delete("/:id", requireSignIn, isAdmin, deleteMemberController);

export default router;
