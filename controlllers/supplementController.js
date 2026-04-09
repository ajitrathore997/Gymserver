import SupplementSale from "../models/SupplementSale.js";
import { User } from "../models/User.js";

const parseRangeDate = (value, endOfDay = false) => {
  if (!value) return null;
  const raw = String(value).trim();
  if (!raw) return null;

  const dateOnlyMatch = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnlyMatch) {
    const year = Number(dateOnlyMatch[1]);
    const month = Number(dateOnlyMatch[2]) - 1;
    const day = Number(dateOnlyMatch[3]);
    const utcMs = endOfDay
      ? Date.UTC(year, month, day, 23, 59, 59, 999)
      : Date.UTC(year, month, day, 0, 0, 0, 0);
    return new Date(utcMs);
  }

  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const getActorFromRequest = async (req) => {
  if (!req?.user?._id) return { id: null, name: "System" };
  const user = await User.findById(req.user._id).select("name");
  return {
    id: user?._id || req.user._id,
    name: user?.name || "Unknown",
  };
};

const getSupplementView = (sale, now = new Date()) => {
  const totalAmount = Number(sale?.totalAmount || 0);
  const paidAmount = Number(sale?.paidAmount || 0);
  const remainingAmount = Math.max(totalAmount - paidAmount, 0);
  const dueDate = sale?.paymentDueDate ? new Date(sale.paymentDueDate) : null;
  const buyDate = sale?.buyDate ? new Date(sale.buyDate) : sale?.createdAt ? new Date(sale.createdAt) : null;
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);

  const isPaid = remainingAmount <= 0;
  const isOverdue = Boolean(
    !isPaid &&
      dueDate &&
      !Number.isNaN(dueDate.getTime()) &&
      dueDate.getTime() < todayStart.getTime()
  );
  const isDueToday = Boolean(
    !isPaid &&
      dueDate &&
      !Number.isNaN(dueDate.getTime()) &&
      dueDate.getTime() >= todayStart.getTime() &&
      dueDate.getTime() < todayStart.getTime() + 24 * 60 * 60 * 1000
  );
  const hasDueDate = Boolean(dueDate && !Number.isNaN(dueDate.getTime()));
  const paymentStatus = isPaid
    ? "Paid"
    : !hasDueDate
    ? "No Due Date"
    : isOverdue
    ? "Overdue"
    : isDueToday
    ? "Due Today"
    : "Upcoming";

  return {
    ...sale.toObject(),
    buyDate,
    totalAmount,
    paidAmount,
    remainingAmount,
    paymentStatus,
    statusNote:
      paymentStatus === "Paid"
        ? "Full payment received"
        : paymentStatus === "No Due Date"
        ? "Pending but no due date is set"
        : paymentStatus === "Overdue"
        ? "Due date has passed and payment is still pending"
        : paymentStatus === "Due Today"
        ? "Payment is due today"
        : "Payment is pending for a future due date",
    isPaid,
    isOverdue,
    isDueToday,
    hasDueDate,
  };
};

const buildSupplementQuery = ({ startDate, endDate, search, status, pendingOnly }) => {
  const query = {};

  if (startDate || endDate) {
    query.buyDate = {};
    if (startDate) {
      const start = parseRangeDate(startDate, false);
      if (start) query.buyDate.$gte = start;
    }
    if (endDate) {
      const end = parseRangeDate(endDate, true);
      if (end) query.buyDate.$lte = end;
    }
    if (!Object.keys(query.buyDate).length) delete query.buyDate;
  }

  if (search) {
    const pattern = new RegExp(String(search).trim(), "i");
    query.$or = [
      { supplementName: pattern },
      { memberName: pattern },
      { memberPhone: pattern },
    ];
  }

  if (status === "No Due Date") {
    query.paymentDueDate = null;
  }

  if (pendingOnly === "true") {
    query.$expr = {
      $gt: [
        { $subtract: [{ $ifNull: ["$totalAmount", 0] }, { $ifNull: ["$paidAmount", 0] }] },
        0,
      ],
    };
  }

  return query;
};

const createSupplementController = async (req, res) => {
  try {
    const { supplementName, memberName, memberPhone, totalAmount, paidAmount, buyDate, paymentDueDate, note } = req.body;
    if (!supplementName || !memberName || totalAmount === undefined) {
      return res.status(400).json({
        success: false,
        message: "supplementName, memberName and totalAmount are required",
      });
    }

    const total = Number(totalAmount || 0);
    const paid = Number(paidAmount || 0);
    if (!Number.isFinite(total) || total < 0 || !Number.isFinite(paid) || paid < 0) {
      return res.status(400).json({
        success: false,
        message: "Amounts must be valid positive numbers",
      });
    }

    const actor = await getActorFromRequest(req);
    const supplement = await new SupplementSale({
      supplementName,
      memberName,
      memberPhone,
      totalAmount: total,
      paidAmount: paid,
      buyDate: buyDate ? new Date(buyDate) : new Date(),
      paymentDueDate: paymentDueDate ? new Date(paymentDueDate) : null,
      note,
      createdBy: actor,
      updatedBy: actor,
    }).save();

    return res.status(201).json({
      success: true,
      message: "Supplement entry created successfully",
      supplement: getSupplementView(supplement),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error creating supplement entry",
      error,
    });
  }
};

const getSupplementsController = async (req, res) => {
  try {
    const {
      startDate,
      endDate,
      search = "",
      status = "",
      pendingOnly = "false",
      page = 1,
      limit = 20,
    } = req.query;
    const query = buildSupplementQuery({ startDate, endDate, search, status, pendingOnly });
    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);

    const supplementsRaw = await SupplementSale.find(query).sort({ buyDate: -1, createdAt: -1 });
    let supplements = supplementsRaw.map((sale) => getSupplementView(sale));
    if (status && !["No Due Date", "", "Pending"].includes(status)) {
      supplements = supplements.filter((sale) =>
        sale.paymentStatus === status
      );
    }
    const total = supplements.length;
    const skip = (pageNum - 1) * limitNum;
    const pagedSupplements = supplements.slice(skip, skip + limitNum);

    return res.status(200).json({
      success: true,
      supplements: pagedSupplements,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.max(Math.ceil(total / limitNum), 1),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error getting supplement entries",
      error,
    });
  }
};

const updateSupplementController = async (req, res) => {
  try {
    const supplement = await SupplementSale.findById(req.params.id);
    if (!supplement) {
      return res.status(404).json({
        success: false,
        message: "Supplement entry not found",
      });
    }

    const actor = await getActorFromRequest(req);
    const { supplementName, memberName, memberPhone, totalAmount, paidAmount, buyDate, paymentDueDate, note } = req.body;

    if (supplementName !== undefined) supplement.supplementName = supplementName;
    if (memberName !== undefined) supplement.memberName = memberName;
    if (memberPhone !== undefined) supplement.memberPhone = memberPhone;
    if (totalAmount !== undefined) supplement.totalAmount = Math.max(Number(totalAmount || 0), 0);
    if (paidAmount !== undefined) supplement.paidAmount = Math.max(Number(paidAmount || 0), 0);
    if (buyDate !== undefined) supplement.buyDate = buyDate ? new Date(buyDate) : null;
    if (paymentDueDate !== undefined) supplement.paymentDueDate = paymentDueDate ? new Date(paymentDueDate) : null;
    if (note !== undefined) supplement.note = note;
    supplement.updatedBy = actor;

    await supplement.save();

    return res.status(200).json({
      success: true,
      message: "Supplement entry updated",
      supplement: getSupplementView(supplement),
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating supplement entry",
      error,
    });
  }
};

const deleteSupplementController = async (req, res) => {
  try {
    const supplement = await SupplementSale.findByIdAndDelete(req.params.id);
    if (!supplement) {
      return res.status(404).json({
        success: false,
        message: "Supplement entry not found",
      });
    }

    return res.status(200).json({
      success: true,
      message: "Supplement entry deleted",
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting supplement entry",
      error,
    });
  }
};

const getSupplementsDashboardController = async (req, res) => {
  try {
    const supplementsRaw = await SupplementSale.find({}).sort({ paymentDueDate: 1, createdAt: -1 });
    const supplements = supplementsRaw.map((sale) => getSupplementView(sale));

    const stats = supplements.reduce(
      (acc, sale) => {
        acc.totalEntries += 1;
        acc.totalSales += Number(sale.totalAmount || 0);
        acc.totalCollected += Number(sale.paidAmount || 0);
        acc.totalOutstanding += Number(sale.remainingAmount || 0);
        if (sale.paymentStatus === "Paid") acc.paidCount += 1;
        if (sale.paymentStatus !== "Paid") acc.pendingSalesCount += 1;
        if (sale.paymentStatus === "Upcoming") acc.upcomingCount += 1;
        if (sale.paymentStatus === "No Due Date") acc.noDueDateCount += 1;
        if (sale.paymentStatus === "Overdue") acc.overdueCount += 1;
        if (sale.isDueToday) acc.dueTodayCount += 1;
        return acc;
      },
      {
        totalEntries: 0,
        totalSales: 0,
        totalCollected: 0,
        totalOutstanding: 0,
        paidCount: 0,
        pendingSalesCount: 0,
        upcomingCount: 0,
        noDueDateCount: 0,
        overdueCount: 0,
        dueTodayCount: 0,
      }
    );

    return res.status(200).json({
      success: true,
      stats: {
        ...stats,
        recentPending: supplements
          .filter((sale) => sale.paymentStatus !== "Paid"),
      },
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error getting supplement dashboard stats",
      error,
    });
  }
};

export {
  createSupplementController,
  getSupplementsController,
  updateSupplementController,
  deleteSupplementController,
  getSupplementsDashboardController,
};
