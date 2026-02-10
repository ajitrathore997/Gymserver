import Expense from "../models/Expense.js";
import { User } from "../models/User.js";

const getActorFromRequest = async (req) => {
  if (!req?.user?._id) return { id: null, name: "System" };
  const user = await User.findById(req.user._id).select("name");
  return {
    id: user?._id || req.user._id,
    name: user?.name || "Unknown",
  };
};

const createExpenseController = async (req, res) => {
  try {
    const { name, amount, date, note } = req.body;
    if (!name || amount === undefined || !date) {
      return res.status(400).json({
        success: false,
        message: "name, amount and date are required",
      });
    }

    const actor = await getActorFromRequest(req);
    const expense = await new Expense({
      name,
      amount: Number(amount),
      date: new Date(date),
      note,
      createdBy: actor,
    }).save();

    return res.status(201).json({
      success: true,
      message: "Expense created successfully",
      expense,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating expense",
      error,
    });
  }
};

const getExpensesController = async (req, res) => {
  try {
    const { startDate, endDate, page = 1, limit = 20 } = req.query;
    const query = {};
    if (startDate || endDate) {
      query.date = {};
      if (startDate) query.date.$gte = new Date(startDate);
      if (endDate) query.date.$lte = new Date(endDate);
    }

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    const [expenses, total] = await Promise.all([
      Expense.find(query).sort({ date: -1 }).skip(skip).limit(limitNum),
      Expense.countDocuments(query),
    ]);

    return res.status(200).json({
      success: true,
      expenses,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error getting expenses",
      error,
    });
  }
};

const updateExpenseController = async (req, res) => {
  try {
    const { name, amount, date, note } = req.body;
    const expense = await Expense.findById(req.params.id);
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    if (name !== undefined) expense.name = name;
    if (amount !== undefined) expense.amount = Number(amount);
    if (date !== undefined) expense.date = new Date(date);
    if (note !== undefined) expense.note = note;

    await expense.save();
    return res.status(200).json({
      success: true,
      message: "Expense updated",
      expense,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating expense",
      error,
    });
  }
};

const deleteExpenseController = async (req, res) => {
  try {
    const expense = await Expense.findByIdAndDelete(req.params.id);
    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Expense deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting expense",
      error,
    });
  }
};

export {
  createExpenseController,
  getExpensesController,
  updateExpenseController,
  deleteExpenseController,
};
