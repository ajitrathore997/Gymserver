import express from "express";
import {
  createSupplementController,
  deleteSupplementController,
  getSupplementsController,
  getSupplementsDashboardController,
  updateSupplementController,
} from "../controlllers/supplementController.js";
import { requireSignIn, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.get("/dashboard", requireSignIn, isAdmin, getSupplementsDashboardController);
router.post("/", requireSignIn, isAdmin, createSupplementController);
router.get("/", requireSignIn, isAdmin, getSupplementsController);
router.put("/:id", requireSignIn, isAdmin, updateSupplementController);
router.delete("/:id", requireSignIn, isAdmin, deleteSupplementController);

export default router;
