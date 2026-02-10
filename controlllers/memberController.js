import Member from "../models/Member.js";
import { User } from "../models/User.js";
import Expense from "../models/Expense.js";

const getDurationMonths = (duration) => {
  if (duration === undefined || duration === null) return 1;
  if (typeof duration === "number") return duration;
  const value = String(duration).toLowerCase();
  if (value.includes("year")) return 12;
  if (value.includes("6")) return 6;
  if (value.includes("3")) return 3;
  return 1;
};

const getEndDate = (startDate, duration) => {
  if (!startDate) return null;
  const months = getDurationMonths(duration);
  const endDate = new Date(startDate);
  if (Number.isNaN(endDate.getTime())) return null;
  endDate.setMonth(endDate.getMonth() + months);
  return endDate;
};

const addMonths = (date, months) => {
  const next = new Date(date);
  if (Number.isNaN(next.getTime())) return null;
  next.setMonth(next.getMonth() + months);
  return next;
};

const getActorFromRequest = async (req) => {
  if (!req?.user?._id) return { id: null, name: "System" };
  const user = await User.findById(req.user._id).select("name");
  return {
    id: user?._id || req.user._id,
    name: user?.name || "Unknown",
  };
};

const buildCycle = (startDate, cycleMonths, fee) => {
  const endDate = addMonths(startDate, cycleMonths);
  return {
    startDate,
    endDate,
    cycleMonths,
    fee,
    paidAmount: 0,
    remainingAmount: Math.max(fee - 0, 0),
    status: fee === 0 ? "Paid" : "Pending",
    payments: [],
  };
};

const ensurePaymentCycles = (member) => {
  const cycles = Array.isArray(member.paymentCycles)
    ? member.paymentCycles
    : [];
  const cycleMonths = getDurationMonths(member.duration);
  const fee = Number(member.fee || 0);
  const now = new Date();

  if (cycles.length === 0) {
    const start = member.startDate ? new Date(member.startDate) : now;
    cycles.push(buildCycle(start, cycleMonths, fee));
  }

  let last = cycles[cycles.length - 1];
  if (!last.endDate) {
    last.endDate = addMonths(last.startDate, last.cycleMonths || cycleMonths);
  }

  while (last.endDate && last.endDate < now) {
    const nextStart = new Date(last.endDate);
    const next = buildCycle(nextStart, cycleMonths, fee);
    cycles.push(next);
    last = next;
  }

  member.paymentCycles = cycles;
};

const applyPaymentToCycles = (member, amount, actor, note, at, type = "payment") => {
  let remaining = Number(amount || 0);
  if (remaining === 0) return { applied: 0, allocations: [] };
  const allocations = [];
  const cycles = member.paymentCycles || [];
  const cycleMonths = getDurationMonths(member.duration);
  const fee = Number(member.fee || 0);

  let index = 0;
  while (remaining > 0) {
    const cycle = cycles[index];
    if (!cycle) {
      const last = cycles[cycles.length - 1];
      const nextStart = last?.endDate ? new Date(last.endDate) : new Date();
      cycles.push(buildCycle(nextStart, cycleMonths, fee));
      continue;
    }

    if (cycle.remainingAmount <= 0) {
      index += 1;
      continue;
    }

    const applied = Math.min(cycle.remainingAmount, remaining);
    cycle.paidAmount += applied;
    cycle.remainingAmount -= applied;
    cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
    cycle.payments.push({
      amount: applied,
      type,
      by: actor,
      at,
      note,
    });
    allocations.push({
      startDate: cycle.startDate,
      endDate: cycle.endDate,
      amount: applied,
    });
    remaining -= applied;
    if (cycle.remainingAmount <= 0) {
      index += 1;
    }
  }

  return { applied: Number(amount || 0) - remaining, allocations };
};

const applyAdjustmentToCurrentCycle = (member, amount, actor, note, at) => {
  const cycles = member.paymentCycles || [];
  const current = cycles[cycles.length - 1];
  if (!current || amount === 0) return;
  const adjust = Math.min(current.paidAmount, Math.abs(amount));
  current.paidAmount -= adjust;
  current.remainingAmount = Math.max(current.fee - current.paidAmount, 0);
  current.status = current.remainingAmount === 0 ? "Paid" : "Pending";
  current.payments.push({
    amount: -adjust,
    type: "adjustment",
    by: actor,
    at,
    note,
  });
};

const adjustPaymentHistoryEntry = (member, historyIndex, newAmount, actor, note) => {
  if (!Array.isArray(member.paymentHistory)) {
    throw new Error("Payment history not available");
  }
  const entry = member.paymentHistory[historyIndex];
  if (!entry) {
    throw new Error("Payment history entry not found");
  }
  if (entry.type !== "payment") {
    throw new Error("Only payment entries can be adjusted");
  }
  const oldAmount = Number(entry.amount || 0);
  const targetAmount = Number(newAmount || 0);
  const delta = targetAmount - oldAmount;
  if (delta === 0) return { delta: 0, allocations: [] };

  const allocations = Array.isArray(entry.allocations) ? entry.allocations : [];
  if (allocations.length === 0) {
    throw new Error("Cannot adjust payment without allocations");
  }

  let remaining = delta;
  const cycleAdjustments = [];

  for (const alloc of allocations) {
    if (remaining === 0) break;
    const cycle = (member.paymentCycles || []).find((c) => {
      return (
        c.startDate &&
        c.endDate &&
        new Date(c.startDate).getTime() === new Date(alloc.startDate).getTime() &&
        new Date(c.endDate).getTime() === new Date(alloc.endDate).getTime()
      );
    });
    if (!cycle) continue;

    if (remaining > 0) {
      const add = Math.min(Number(cycle.remainingAmount || 0), remaining);
      if (add > 0) {
        cycle.paidAmount += add;
        cycle.remainingAmount -= add;
        cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
        cycle.payments.push({
          amount: add,
          type: "adjustment",
          by: actor,
          at: new Date(),
          note,
        });
        cycleAdjustments.push({
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          amount: add,
        });
        remaining -= add;
      }
    } else {
      const reduce = Math.min(Number(cycle.paidAmount || 0), Math.abs(remaining));
      if (reduce > 0) {
        cycle.paidAmount -= reduce;
        cycle.remainingAmount = Math.max(cycle.fee - cycle.paidAmount, 0);
        cycle.status = cycle.remainingAmount === 0 ? "Paid" : "Pending";
        cycle.payments.push({
          amount: -reduce,
          type: "adjustment",
          by: actor,
          at: new Date(),
          note,
        });
        cycleAdjustments.push({
          startDate: cycle.startDate,
          endDate: cycle.endDate,
          amount: -reduce,
        });
        remaining += reduce;
      }
    }
  }

  if (remaining !== 0) {
    throw new Error("Cannot apply adjustment due to cycle limits");
  }

  entry.amount = targetAmount;

  return { delta, allocations: cycleAdjustments };
};

const syncMemberPaymentSummary = (member) => {
  const cycles = member.paymentCycles || [];
  const current = cycles.length ? cycles[cycles.length - 1] : null;
  const totalRemaining = cycles.reduce(
    (sum, c) => sum + Number(c.remainingAmount || 0),
    0
  );
  if (current) {
    member.paidAmount = Number(current.paidAmount || 0);
  }
  member.remainingAmount = totalRemaining;
  member.paymentStatus =
    member.paymentStatus === "Free Trial" && Number(member.fee || 0) === 0
      ? "Free Trial"
      : totalRemaining === 0
      ? "Paid"
      : "Pending";
};

const createMemberController = async (req, res) => {
  try {
    const fee = Number(req.body.fee || 0);
    const paidAmount = Number(req.body.paidAmount || 0);
    const paymentStatus =
      req.body.paymentStatus === "Free Trial" && fee === 0
        ? "Free Trial"
        : "Pending";

    const actor = await getActorFromRequest(req);
    const activityEntry = {
      action: "create",
      by: actor,
      at: new Date(),
      changes: {
        fee,
        paidAmount,
        paymentStatus,
      },
    };

    const member = new Member({
      ...req.body,
      fee,
      paymentStatus,
      createdBy: actor,
      updatedBy: actor,
      activityHistory: [activityEntry],
      paymentHistory: [],
      paymentCycles: [],
    });

    ensurePaymentCycles(member);

    let appliedOnCreate = null;
    if (paidAmount > 0) {
      appliedOnCreate = applyPaymentToCycles(
        member,
        paidAmount,
        actor,
        req.body.paymentNote,
        new Date()
      );
    }

    syncMemberPaymentSummary(member);

    if (appliedOnCreate?.applied > 0) {
      member.paymentHistory.push({
        amount: paidAmount,
        type: "payment",
        fee,
        paidAmount: member.paidAmount,
        remainingAmount: member.remainingAmount,
        paymentStatus: member.paymentStatus,
        by: actor,
        at: new Date(),
        note: req.body.paymentNote,
        allocations: appliedOnCreate.allocations,
      });
    }

    await member.save();
    return res.status(201).json({
      success: true,
      message: "Member created successfully",
      member,
    });
  } catch (error) {
    console.error("Error creating member:", error);
    return res.status(500).json({
      success: false,
      message: "Error creating member",
      error,
    });
  }
};

const getMembersController = async (req, res) => {
  try {
    const {
      search,
      paymentStatus,
      membershipType,
      personalTrainer,
      minRemaining,
      maxRemaining,
      minFee,
      maxFee,
      minPaid,
      maxPaid,
      startFrom,
      startTo,
      sortBy = "createdAt",
      sortOrder = "desc",
      page = 1,
      limit = 20,
    } = req.query;

    const query = {};

    if (search) {
      const regex = new RegExp(search, "i");
      query.$or = [
        { name: regex },
        { email: regex },
        { phone: regex },
        { assignedTrainer: regex },
      ];
    }

    if (paymentStatus) query.paymentStatus = paymentStatus;
    if (membershipType) query.membershipType = membershipType;
    if (personalTrainer) query.personalTrainer = personalTrainer;

    const toNum = (v) => (v === undefined ? undefined : Number(v));

    // const remainingQuery = {};
    // if (toNum(minRemaining) !== undefined) remainingQuery.$gte = toNum(minRemaining);
    // if (toNum(maxRemaining) !== undefined) remainingQuery.$lte = toNum(maxRemaining);
    // if (Object.keys(remainingQuery).length) query.remainingAmount = remainingQuery;

    // const feeQuery = {};
    // if (toNum(minFee) !== undefined) feeQuery.$gte = toNum(minFee);
    // if (toNum(maxFee) !== undefined) feeQuery.$lte = toNum(maxFee);
    // if (Object.keys(feeQuery).length) query.fee = feeQuery;

    // const paidQuery = {};
    // if (toNum(minPaid) !== undefined) paidQuery.$gte = toNum(minPaid);
    // if (toNum(maxPaid) !== undefined) paidQuery.$lte = toNum(maxPaid);
    // if (Object.keys(paidQuery).length) query.paidAmount = paidQuery;

    const addRangeQuery = (query, field, min, max) => {
  const range = {};

  if (min !== undefined && min !== null && min !== '')
    range.$gte = Number(min);

  if (max !== undefined && max !== null && max !== '')
    range.$lte = Number(max);

  if (Object.keys(range).length) {
    query[field] = range;
  }
};

addRangeQuery(query, 'remainingAmount', minRemaining, maxRemaining);
addRangeQuery(query, 'fee', minFee, maxFee);
addRangeQuery(query, 'paidAmount', minPaid, maxPaid);


    if (startFrom || startTo) {
      query.startDate = {};
      if (startFrom) query.startDate.$gte = new Date(startFrom);
      if (startTo) query.startDate.$lte = new Date(startTo);
    }

    const safeSortFields = new Set([
      "createdAt",
      "name",
      "fee",
      "paidAmount",
      "remainingAmount",
      "startDate",
    ]);
    const sortField = safeSortFields.has(sortBy) ? sortBy : "createdAt";
    const sortDir = String(sortOrder).toLowerCase() === "asc" ? 1 : -1;
    const sort = { [sortField]: sortDir };

    const pageNum = Math.max(Number(page) || 1, 1);
    const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
    const skip = (pageNum - 1) * limitNum;

    // console.log("Query:", query);
    const [members, total] = await Promise.all([
      Member.find(query).sort(sort).skip(skip).limit(limitNum),
      Member.countDocuments(query),
    ]);

    const membersWithPayments = await Promise.all(members.map(async (m) => {
      ensurePaymentCycles(m);
      syncMemberPaymentSummary(m);
      if (m.isModified()) {
        await m.save();
      }
      const obj = m.toObject();
      const history = Array.isArray(obj.paymentHistory)
        ? obj.paymentHistory
        : [];
      const lastPayment = history.length ? history[history.length - 1] : null;
      return { ...obj, lastPayment };
    }));

    return res.status(200).json({
      success: true,
      members: membersWithPayments,
      page: pageNum,
      limit: limitNum,
      total,
      totalPages: Math.ceil(total / limitNum),
    });
  } catch (error) {
    console.error("Error getting members:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting members",
      error,
    });
  }
};

const getMemberByIdController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    ensurePaymentCycles(member);
    syncMemberPaymentSummary(member);
    await member.save();
    const cycles = member.paymentCycles || [];
    const currentCycle = cycles.length ? cycles[cycles.length - 1] : null;
    const totalOutstanding = cycles.reduce(
      (sum, c) => sum + Number(c.remainingAmount || 0),
      0
    );
    return res.status(200).json({
      success: true,
      member,
      currentCycle,
      totalOutstanding,
    });
  } catch (error) {
    console.error("Error getting member:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting member",
      error,
    });
  }
};

const updateMemberController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const fee =
      req.body.fee !== undefined ? Number(req.body.fee) : member.fee;

    const actor = await getActorFromRequest(req);

    ensurePaymentCycles(member);

    const cycles = member.paymentCycles || [];
    const currentCycle = cycles.length ? cycles[cycles.length - 1] : null;
    const existingPaid = currentCycle ? Number(currentCycle.paidAmount || 0) : 0;
    const desiredPaid =
      req.body.paidAmount !== undefined ? Number(req.body.paidAmount) : existingPaid;
    const paymentDelta = desiredPaid - existingPaid;

    const diff = {};
    const addIfChanged = (field, oldValue, newValue, skipIfUndefined = true) => {
      if (skipIfUndefined && newValue === undefined) return;
      const oldTime =
        oldValue instanceof Date ? oldValue.getTime() : oldValue;
      const newTime =
        newValue instanceof Date ? newValue.getTime() : newValue;
      if (oldTime !== newTime) {
        diff[field] = { from: oldValue ?? null, to: newValue ?? null };
      }
    };

    addIfChanged("name", member.name, req.body.name);
    addIfChanged("email", member.email, req.body.email);
    addIfChanged("phone", member.phone, req.body.phone);
    addIfChanged(
      "membershipType",
      member.membershipType,
      req.body.membershipType
    );
    addIfChanged("startDate", member.startDate, req.body.startDate);
    addIfChanged("duration", member.duration, req.body.duration);
    addIfChanged(
      "personalTrainer",
      member.personalTrainer,
      req.body.personalTrainer
    );
    addIfChanged(
      "assignedTrainer",
      member.assignedTrainer,
      req.body.assignedTrainer
    );
    addIfChanged("fee", member.fee, fee, false);
    addIfChanged("paidAmount", existingPaid, desiredPaid, false);

    const activityEntry = Object.keys(diff).length
      ? {
          action: "update",
          by: actor,
          at: new Date(),
          changes: diff,
        }
      : null;

    if (req.body.startDate !== undefined) member.startDate = req.body.startDate;
    if (req.body.duration !== undefined) member.duration = req.body.duration;
    if (req.body.membershipType !== undefined)
      member.membershipType = req.body.membershipType;
    if (req.body.personalTrainer !== undefined)
      member.personalTrainer = req.body.personalTrainer;
    if (req.body.assignedTrainer !== undefined)
      member.assignedTrainer = req.body.assignedTrainer;
    if (req.body.name !== undefined) member.name = req.body.name;
    if (req.body.email !== undefined) member.email = req.body.email;
    if (req.body.phone !== undefined) member.phone = req.body.phone;
    if (req.body.gender !== undefined) member.gender = req.body.gender;
    if (req.body.address !== undefined) member.address = req.body.address;
    if (req.body.emergencyName !== undefined)
      member.emergencyName = req.body.emergencyName;
    if (req.body.emergencyPhone !== undefined)
      member.emergencyPhone = req.body.emergencyPhone;
    if (req.body.healthNotes !== undefined)
      member.healthNotes = req.body.healthNotes;
    if (req.body.profilePic !== undefined)
      member.profilePic = req.body.profilePic;
    if (req.body.paymentStatus !== undefined) {
      member.paymentStatus = req.body.paymentStatus;
    }

    if (fee !== member.fee) {
      member.fee = fee;
    }

    let paymentHistoryEntry = null;
    if (paymentDelta > 0) {
      const applied = applyPaymentToCycles(
        member,
        paymentDelta,
        actor,
        req.body.paymentNote,
        new Date(),
        "payment"
      );
      if (applied.applied > 0) {
        paymentHistoryEntry = {
          amount: paymentDelta,
          type: "payment",
          fee: member.fee,
          by: actor,
          at: new Date(),
          note: req.body.paymentNote,
          allocations: applied.allocations,
        };
      }
    } else if (paymentDelta < 0) {
      applyAdjustmentToCurrentCycle(
        member,
        paymentDelta,
        actor,
        req.body.paymentNote,
        new Date()
      );
      paymentHistoryEntry = {
        amount: paymentDelta,
        type: "adjustment",
        fee: member.fee,
        by: actor,
        at: new Date(),
        note: req.body.paymentNote,
        allocations: currentCycle
          ? [
              {
                startDate: currentCycle.startDate,
                endDate: currentCycle.endDate,
                amount: paymentDelta,
              },
            ]
          : [],
      };
    }

    if (activityEntry) {
      member.activityHistory.push(activityEntry);
    }
    member.updatedBy = actor;

    syncMemberPaymentSummary(member);

    if (paymentHistoryEntry) {
      member.paymentHistory.push({
        ...paymentHistoryEntry,
        paidAmount: member.paidAmount,
        remainingAmount: member.remainingAmount,
        paymentStatus: member.paymentStatus,
      });
    }

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Member updated successfully",
      member,
    });
  } catch (error) {
    console.error("Error updating member:", error);
    return res.status(500).json({
      success: false,
      message: "Error updating member",
      error,
    });
  }
};

const deleteMemberController = async (req, res) => {
  try {
    const member = await Member.findByIdAndDelete(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    return res.status(200).json({
      success: true,
      message: "Member deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting member:", error);
    return res.status(500).json({
      success: false,
      message: "Error deleting member",
      error,
    });
  }
};

const uploadMemberProfileController = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const baseUrl = `${req.protocol}://${req.get("host")}`;
    const fileUrl = `${baseUrl}/uploads/${req.file.filename}`;
    return res.status(200).json({
      success: true,
      url: fileUrl,
      filename: req.file.filename,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error uploading file",
      error,
    });
  }
};

const adjustMemberPaymentHistoryController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const { historyIndex, newAmount, note } = req.body;
    if (historyIndex === undefined || newAmount === undefined) {
      return res.status(400).json({
        success: false,
        message: "historyIndex and newAmount are required",
      });
    }

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);

    const result = adjustPaymentHistoryEntry(
      member,
      Number(historyIndex),
      Number(newAmount),
      actor,
      note
    );

    syncMemberPaymentSummary(member);

    member.paymentHistory.push({
      amount: result.delta,
      type: "adjustment",
      fee: member.fee,
      paidAmount: member.paidAmount,
      remainingAmount: member.remainingAmount,
      paymentStatus: member.paymentStatus,
      by: actor,
      at: new Date(),
      note,
      allocations: result.allocations,
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment adjusted successfully",
      member,
    });
  } catch (error) {
    return res.status(400).json({
      success: false,
      message: error.message || "Error adjusting payment",
    });
  }
};

const updateMemberPaymentStatusController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    const index = Number(req.params.index);
    const { paymentStatus } = req.body;
    if (!paymentStatus) {
      return res.status(400).json({
        success: false,
        message: "paymentStatus is required",
      });
    }
    if (!Array.isArray(member.paymentHistory) || !member.paymentHistory[index]) {
      return res.status(404).json({
        success: false,
        message: "Payment history entry not found",
      });
    }

    member.paymentHistory[index].paymentStatus = paymentStatus;
    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment status updated",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error updating payment status",
      error,
    });
  }
};

const deleteMemberPaymentHistoryController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }
    const index = Number(req.params.index);
    if (!Array.isArray(member.paymentHistory) || !member.paymentHistory[index]) {
      return res.status(404).json({
        success: false,
        message: "Payment history entry not found",
      });
    }

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);
    const entry = member.paymentHistory[index];
    if (entry.type !== "payment") {
      return res.status(400).json({
        success: false,
        message: "Only payment entries can be deleted",
      });
    }
    adjustPaymentHistoryEntry(member, index, 0, actor, req.body?.note);

    member.paymentHistory.splice(index, 1);

    syncMemberPaymentSummary(member);

    member.paymentHistory.push({
      amount: -Number(entry.amount || 0),
      type: "adjustment",
      fee: member.fee,
      paidAmount: member.paidAmount,
      remainingAmount: member.remainingAmount,
      paymentStatus: member.paymentStatus,
      by: actor,
      at: new Date(),
      note: req.body?.note || "Deleted payment entry",
      allocations: entry.allocations || [],
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment deleted",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error deleting payment",
      error,
    });
  }
};

const addMemberPaymentController = async (req, res) => {
  try {
    const member = await Member.findById(req.params.id);
    if (!member) {
      return res.status(404).json({
        success: false,
        message: "Member not found",
      });
    }

    const amount = Number(req.body.amount || 0);
    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Amount must be greater than 0",
      });
    }

    ensurePaymentCycles(member);
    const actor = await getActorFromRequest(req);
    const paymentAt = req.body.date ? new Date(req.body.date) : new Date();
    const applied = applyPaymentToCycles(
      member,
      amount,
      actor,
      req.body.note,
      paymentAt,
      "payment"
    );

    syncMemberPaymentSummary(member);

    member.paymentHistory.push({
      amount,
      type: "payment",
      fee: member.fee,
      paidAmount: member.paidAmount,
      remainingAmount: member.remainingAmount,
      paymentStatus: member.paymentStatus,
      by: actor,
      at: paymentAt,
      note: req.body.note,
      allocations: applied.allocations,
    });

    await member.save();
    return res.status(200).json({
      success: true,
      message: "Payment added successfully",
      member,
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: "Error adding payment",
      error,
    });
  }
};

const getMemberDashboardController = async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    const filter = {};
    const range = {};
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
      if (startDate) range.$gte = new Date(startDate);
      if (endDate) range.$lte = new Date(endDate);
    }

    const members = await Member.find(filter);
    let expensesInRange = 0;
    let expensesCountInRange = 0;
    const expenseBuckets = {};
    if (range.$gte || range.$lte) {
      const expenseQuery = {};
      expenseQuery.date = {};
      if (range.$gte) expenseQuery.date.$gte = range.$gte;
      if (range.$lte) expenseQuery.date.$lte = range.$lte;
      const expenses = await Expense.find(expenseQuery);
      for (const e of expenses) {
        expensesInRange += Number(e.amount || 0);
        expensesCountInRange += 1;
        const date = e.date ? new Date(e.date) : null;
        if (date && !Number.isNaN(date.getTime())) {
          const key = date.toISOString().slice(0, 10);
          expenseBuckets[key] = (expenseBuckets[key] || 0) + Number(e.amount || 0);
        }
      }
    }
    const now = new Date();
    const nextWeek = new Date();
    nextWeek.setDate(now.getDate() + 7);

    const stats = {
      totalMembers: members.length,
      totalFee: 0,
      totalPaid: 0,
      totalRemaining: 0,
      pendingCount: 0,
      dueNextWeekCount: 0,
      paymentStatusCounts: { Paid: 0, Pending: 0, "Free Trial": 0 },
      membershipTypeCounts: {},
      dueNextWeekMembers: [],
      paidInRange: 0,
      paymentsCountInRange: 0,
      membersJoinedInRange: members.length,
      paymentSeries: [],
      expensesInRange,
      expensesCountInRange,
      netInRange: 0,
      expenseSeries: [],
    };

    const paymentBuckets = {};
    for (const m of members) {
      ensurePaymentCycles(m);
      syncMemberPaymentSummary(m);
      if (m.isModified()) {
        await m.save();
      }
      const fee = Number(m.fee || 0);
      const paid = Number(m.paidAmount || 0);
      const remaining =
        m.remainingAmount ?? Math.max(fee - paid, 0);

      stats.totalFee += fee;
      stats.totalPaid += paid;
      stats.totalRemaining += remaining;

      if (remaining > 0) stats.pendingCount += 1;

      const status =
        m.paymentStatus === "Free Trial" && fee === 0
          ? "Free Trial"
          : remaining === 0
          ? "Paid"
          : "Pending";
      stats.paymentStatusCounts[status] =
        (stats.paymentStatusCounts[status] || 0) + 1;

      const type = m.membershipType || "Other";
      stats.membershipTypeCounts[type] =
        (stats.membershipTypeCounts[type] || 0) + 1;

      const effectiveStartDate = m.startDate || m.createdAt;
      const endDate = getEndDate(effectiveStartDate, m.duration);
      if (endDate && endDate >= now && endDate <= nextWeek) {
        stats.dueNextWeekCount += 1;
        if (stats.dueNextWeekMembers.length < 8) {
          stats.dueNextWeekMembers.push({
            _id: m._id,
            name: m.name,
            phone: m.phone,
            remainingAmount: remaining,
            endDate,
          });
        }
      }

      if (range.$gte || range.$lte) {
        const history = Array.isArray(m.paymentHistory) ? m.paymentHistory : [];
        for (const p of history) {
          if (p.type !== "payment") continue;
          const at = p.at ? new Date(p.at) : null;
          if (!at || Number.isNaN(at.getTime())) continue;
          if (range.$gte && at < range.$gte) continue;
          if (range.$lte && at > range.$lte) continue;
          stats.paidInRange += Number(p.amount || 0);
          stats.paymentsCountInRange += 1;
          const key = at.toISOString().slice(0, 10);
          paymentBuckets[key] = (paymentBuckets[key] || 0) + Number(p.amount || 0);
        }
      }
    }

    if (range.$gte || range.$lte) {
      const start = range.$gte ? new Date(range.$gte) : null;
      const end = range.$lte ? new Date(range.$lte) : null;
      const series = [];
      if (start && end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          const key = cursor.toISOString().slice(0, 10);
          series.push({ date: key, total: paymentBuckets[key] || 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        for (const [date, total] of Object.entries(paymentBuckets)) {
          series.push({ date, total });
        }
        series.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      stats.paymentSeries = series;
    }

    if (range.$gte || range.$lte) {
      const start = range.$gte ? new Date(range.$gte) : null;
      const end = range.$lte ? new Date(range.$lte) : null;
      const series = [];
      if (start && end) {
        const cursor = new Date(start);
        while (cursor <= end) {
          const key = cursor.toISOString().slice(0, 10);
          series.push({ date: key, total: expenseBuckets[key] || 0 });
          cursor.setDate(cursor.getDate() + 1);
        }
      } else {
        for (const [date, total] of Object.entries(expenseBuckets)) {
          series.push({ date, total });
        }
        series.sort((a, b) => new Date(a.date) - new Date(b.date));
      }
      stats.expenseSeries = series;
    }

    stats.netInRange = Number(stats.paidInRange || 0) - Number(stats.expensesInRange || 0);

    stats.dueNextWeekMembers.sort(
      (a, b) => new Date(a.endDate) - new Date(b.endDate)
    );

    return res.status(200).json({ success: true, stats });
  } catch (error) {
    console.error("Error getting member dashboard stats:", error);
    return res.status(500).json({
      success: false,
      message: "Error getting member dashboard stats",
      error,
    });
  }
};

export {
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
};
