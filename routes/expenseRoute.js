import express from "express";
import {
  createExpenseController,
  getExpensesController,
  updateExpenseController,
  deleteExpenseController,
} from "../controlllers/expenseController.js";
import { requireSignIn, isAdmin } from "../Middlewares/authMiddleware.js";

const router = express.Router();

router.post("/", requireSignIn, isAdmin, createExpenseController);
router.get("/", requireSignIn, isAdmin, getExpensesController);
router.put("/:id", requireSignIn, isAdmin, updateExpenseController);
router.delete("/:id", requireSignIn, isAdmin, deleteExpenseController);

export default router;
